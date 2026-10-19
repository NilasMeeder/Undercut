"""Track evolution (qualifying): how much quicker the track got over the session.

Every push lap is the driver's own level, plus the tyre (compound, age), plus the track at that
moment, plus noise: lap_time = level[driver] + compound + age * k + track(t) + e. The track is a
smooth curve over session time (linear between knots ~10 min apart, a penalty on bends), fitted
with Huber weights so a scruffy lap does not pull it. Per driver it gives the track gain at his
best lap and what that lap was worth on the track of the end.

Only qualifying and sprint qualifying: in practice fuel loads and programmes change through the
session and are not in the data (FP1 and FP2 come out "slower" at the end, the long runs).
Whatever makes everyone quicker over time counts as track: rubber, temperature, wind, and the
drivers pushing harder in Q3.
"""

from dataclasses import dataclass

import numpy as np

from app import sessions
from app.generations import session_cache
from app.schemas import EvolutionDriver, EvolutionLap, Lap, TrackEvolution

SESSIONS = ("Q", "SQ", "SS")
SLICKS = ("SOFT", "MEDIUM", "HARD")
PUSH = 1.025
"""A push lap is within this share of the driver's best lap (in the laps that count)."""
KNOT_SPACING = 600.0
"""Seconds between the knots of the track curve."""
SMOOTHING = 0.5
"""Weight of the penalty on the curve's second differences (s² per knot)."""
HUBER = 1.345
FIT_ROUNDS = 10
GRID = 30.0
"""Seconds between the points of the curve in the response."""
MIN_LAPS = 12


@dataclass(frozen=True)
class PushLap:
    driver: str
    lap: int
    time: float
    """Session time (s) halfway round the lap."""
    lap_time: float
    compound: str
    age: int
    """Laps on the tyre before this one."""


def push_laps(laps: list[Lap], until: float | None = None) -> list[PushLap]:
    """Timed laps on slicks under green, not in or out of the pits, within PUSH of the driver's
    best (deleted laps count: the time was driven)."""
    done = [
        lap
        for lap in laps
        if lap.lap_time is not None
        and lap.end_time is not None
        and (until is None or lap.end_time <= until)
        and not lap.pit_in
        and not lap.pit_out
        and lap.compound in SLICKS
        and (lap.track_status or "1") == "1"
    ]
    best: dict[str, float] = {}
    for lap in done:
        best[lap.driver] = min(best.get(lap.driver, np.inf), lap.lap_time or np.inf)
    return [
        PushLap(
            driver=lap.driver,
            lap=lap.lap,
            time=(lap.end_time or 0.0) - (lap.lap_time or 0.0) / 2,
            lap_time=lap.lap_time or 0.0,
            compound=lap.compound or "SOFT",
            age=max((lap.tyre_life or 1) - 1, 0),
        )
        for lap in done
        if (lap.lap_time or np.inf) <= best[lap.driver] * PUSH
    ]


def hats(t: np.ndarray, knots: np.ndarray) -> np.ndarray:
    """Linear interpolation between the knots as a matrix: column j is 1 at knot j, 0 at its
    neighbours (flat beyond the ends)."""
    t = np.clip(t, knots[0], knots[-1])
    out = np.zeros((len(t), len(knots)))
    j = np.clip(np.searchsorted(knots, t, side="right") - 1, 0, len(knots) - 2)
    share = (t - knots[j]) / (knots[j + 1] - knots[j])
    rows = np.arange(len(t))
    out[rows, j] = 1 - share
    out[rows, j + 1] = share
    return out


@dataclass(frozen=True)
class Fit:
    knots: np.ndarray
    track: np.ndarray
    """The track at each knot (s on a lap), 0 at the first."""
    level: dict[str, float]
    compound: dict[str, float]
    age: float
    residual: np.ndarray
    """Per push lap: lap time minus the fit."""
    spread: float
    """Robust standard deviation of the residuals (s)."""

    def track_at(self, t: np.ndarray | float) -> np.ndarray:
        return hats(np.atleast_1d(np.asarray(t, dtype=float)), self.knots) @ self.track


def fit(push: list[PushLap]) -> Fit:
    t = np.array([p.time for p in push])
    y = np.array([p.lap_time for p in push])
    drivers = sorted({p.driver for p in push})
    compounds = sorted({p.compound for p in push}, key=SLICKS.index)
    n_knots = max(int(np.ceil((t.max() - t.min()) / KNOT_SPACING)) + 1, 2)
    knots = np.linspace(t.min(), t.max(), n_knots)
    if knots[-1] - knots[0] < 1:
        knots = np.array([t.min(), t.min() + 1.0])

    columns = [
        np.array([[p.driver == d for d in drivers] for p in push], dtype=float),
        # The first (softest) compound is the reference.
        np.array([[p.compound == c for c in compounds[1:]] for p in push], dtype=float).reshape(
            len(push), -1
        ),
        np.array([[p.age] for p in push], dtype=float),
        hats(t, knots)[:, 1:],  # track 0 at the first knot
    ]
    x = np.hstack(columns)
    first_knot = x.shape[1] - (n_knots - 1)
    penalty = np.zeros((max(n_knots - 2, 0), x.shape[1]))
    for i in range(n_knots - 2):
        for k, w in zip(range(i, i + 3), (1.0, -2.0, 1.0), strict=True):
            if k > 0:
                penalty[i, first_knot + k - 1] = w

    weights = np.ones(len(y))
    beta = np.zeros(x.shape[1])
    spread = 0.1
    for _ in range(FIT_ROUNDS):
        root = np.sqrt(weights)
        a = np.vstack([x * root[:, None], np.sqrt(SMOOTHING) * penalty])
        b = np.concatenate([y * root, np.zeros(len(penalty))])
        beta = np.linalg.lstsq(a, b, rcond=None)[0]
        residual = y - x @ beta
        spread = float(1.4826 * np.median(np.abs(residual))) or 0.1
        limit = HUBER * spread
        size = np.abs(residual)
        weights = np.where(size <= limit, 1.0, limit / np.maximum(size, 1e-9))

    n_drivers, n_compounds = len(drivers), len(compounds) - 1
    return Fit(
        knots=knots,
        track=np.concatenate([[0.0], beta[first_knot:]]),
        level=dict(zip(drivers, beta[:n_drivers].tolist(), strict=True)),
        compound={
            compounds[0]: 0.0,
            **dict(
                zip(compounds[1:], beta[n_drivers : n_drivers + n_compounds].tolist(), strict=True)
            ),
        },
        age=float(beta[n_drivers + n_compounds]),
        residual=y - x @ beta,
        spread=spread,
    )


def evolution(laps: list[Lap], until: float | None = None) -> TrackEvolution:
    push = push_laps(laps, until)
    if len(push) < MIN_LAPS or len({p.driver for p in push}) < 3:
        raise LookupError("Not enough push laps yet for the track evolution")
    result = fit(push)
    start, end = float(result.knots[0]), float(result.knots[-1])
    times = np.append(np.arange(start, end, GRID), end)
    # Gain: seconds quicker than at the first push lap (the track curve upside down).
    gain = -result.track_at(times)
    gain_end = float(-result.track_at(end)[0])

    points = [
        EvolutionLap(
            driver=p.driver,
            lap=p.lap,
            time=round(p.time, 1),
            gain=round(float(-(result.track_at(p.time)[0] + r)), 3),
        )
        for p, r in zip(push, result.residual, strict=True)
    ]

    best: dict[str, PushLap] = {}
    for p in push:
        if p.driver not in best or p.lap_time < best[p.driver].lap_time:
            best[p.driver] = p
    drivers = []
    for p in best.values():
        then = float(-result.track_at(p.time)[0])
        drivers.append(
            EvolutionDriver(
                driver=p.driver,
                lap=p.lap,
                lap_time=round(p.lap_time, 3),
                time=round(p.time, 1),
                gain=round(then, 3),
                worth=round(p.lap_time - (gain_end - then), 3),
            )
        )
    drivers.sort(key=lambda d: d.worth)

    last = max(start, end - KNOT_SPACING)
    return TrackEvolution(
        times=np.round(times, 1).tolist(),
        gain=np.round(gain, 3).tolist(),
        total=round(gain_end, 3),
        recent=round(gain_end - float(-result.track_at(last)[0]), 3),
        recent_minutes=round((end - last) / 60),
        spread=round(result.spread, 3),
        points=points,
        drivers=drivers,
    )


@session_cache(maxsize=64)
def get_evolution(
    year: int, round_number: int, code: str, until: float | None = None
) -> TrackEvolution:
    if code not in SESSIONS:
        raise LookupError("Track evolution is for qualifying and sprint qualifying")
    return evolution(sessions.get_laps(year, round_number, code), until)
