"""Estimated energy deployment (2026): where a car stops gaining speed at full throttle.

There is no channel for the battery or the MGU-K. What the data does show is acceleration: at full
throttle a car accelerates as hard as its power allows, and with the MGU-K deploying that is far
more than on the engine alone (at 230 km/h roughly 9 against 3.5 m/s² at Monza 2026). So:

- acceleration a from the speed trace on a 0.1 s grid, fitted over a 1 s window (the speed is
  ~4 Hz in whole km/h, too coarse for a plain difference), kept inside the full-throttle run so
  braking never leaks into it, and corrected for the slope (z);
- straights are full-throttle runs of at least MIN_STRAIGHT metres, named after the corner they
  brake for; the main straight takes the tail of the previous lap, so it does not stop at the line;
- the envelope of a straight is, per speed, the 95th percentile over the clean laps of the
  session of each lap's median acceleration on that straight: what the best laps managed there,
  taken as full deployment (tow and overtake mode included, so in a race it sits higher);
- clipping is full throttle without gaining speed (a < FLAT) where the envelope still gains. Its
  cost is the speed and time the car would have had by following the envelope from the first
  such point on, up the same hill, never faster than the top speed reached on that straight;
- cornering at full throttle (Curva Grande, Raidillon, Blanchimont) is not judged: there grip
  and drag set the speed, and a projection does what the lap did;
- deploy is the acceleration as a share of the envelope at that speed: 100% = as hard as the
  best laps there, 0 = not gaining, negative = losing speed at full throttle (harvesting);
- deploying is gaining clearly more than the engine alone could: the session's envelope over
  all straights (full deployment at that speed, wherever it was seen) less what the MGU-K adds
  at that speed (K_POWER over mass × speed), at least FLAT, and only where power and not grip
  sets the acceleration (from DEPLOY_MIN_SPEED). Not the straight's own envelope: where nobody
  deploys (out of Parabolica) that one is the engine alone. Above ~300 km/h the engine alone
  gains nothing, so any gain there is the battery;
- a downshift at full throttle on a straight keeps the engine at or above 10,500 rpm, where the
  2026 fuel energy flow is at its maximum (below it falls by 0.27 MJ/h per rpm): in the data it
  comes when the car is losing speed at full throttle, near the end of a straight.
"""

from dataclasses import dataclass, field

import numpy as np

from app.analysis import POSITION_UNITS_PER_METRE, THROTTLE_FULL, LapTrace

DT = 0.1
"""Seconds between two points of the analysis grid."""

HALF_WINDOW = 0.5
"""Acceleration is the speed change over ±this many seconds."""

DATA_GAP = 1.0
"""Samples further apart than this (s) are a hole in the data, not a straight."""

THROTTLE_GLITCH = 0.3
"""Throttle dips shorter than this (s), without braking, do not end a run."""

MIN_STRAIGHT = 250.0
"""Full-throttle runs shorter than this (m) are not straights."""

PREVIOUS_TAIL = 3000.0
"""Metres of the previous lap put in front of a lap, for the straight across the line (Baku's
runs ~2.2 km to the line)."""

CORNER_SLACK = 50.0
"""A run that ends up to this far (m) past a corner's distance still brakes for that corner."""

FLAT = 0.5
"""m/s² (1.8 km/h per second): below this the car no longer gains speed."""

MIN_CLIP = 40.0
"""Shorter flat stretches (m) are noise: one or two samples at ~90 m/s."""

CLIP_MARGIN = 1.0
"""m/s²: not gaining counts as clipping where the envelope gains at least this much more."""

MIN_GAIN = 3.0
"""km/h: a flat stretch counts as clipping only if the envelope says the car could still gain
this much. Otherwise the car is at the top speed its drag allows, battery or not."""

SPEED_BIN = 5.0
"""km/h per envelope bin."""

PERCENTILE = 95.0
"""Of the laps' medians per speed: the best laps, not the single best (a tow, a gust)."""

MIN_LAPS = 3
"""Laps a speed bin of an envelope needs."""

LOW_SPEED = 50.0
"""km/h: projections can start this slow; below a straight's lowest bin its acceleration holds."""

TOP_ACCEL = 0.05
"""m/s²: where the envelope falls to this, the car has reached its top speed."""

BRAKE_SEARCH = 400.0
"""After a lift, look this far (m) for the brake."""

MIN_DOWNSHIFT_SPEED = 200.0
"""km/h: a downshift at full throttle faster than this is not for a corner."""

DEPLOY_MIN_ENVELOPE = 1.0
"""m/s²: deploy is a share of at least this much. Near the top speed the envelope falls to
zero, and 0.1 of 0.2 would read as 50%; losing speed there still shows as harvesting."""

DEPLOY_MIN_STRETCH = 0.5
"""Seconds: judged stretches shorter than this (between two fast corners) are noise."""

DEPLOY_RANGE = (-100.0, 150.0)
"""Deploy (%) is clamped to this: beyond it the noise of the speed trace dominates."""

K_POWER = 280_000.0
"""W the MGU-K adds at the wheels, as the data shows it: at Monza 2026 at 230 km/h the best
laps gain ~9 m/s² against ~3.5 on the engine alone, 5.5 × MASS × 64 m/s. The rules allow
350 kW at the MGU-K; the drivetrain and the real mass take the rest."""

MASS = 800.0
"""kg: the 2026 minimum with the driver (768) plus some fuel."""

DEPLOY_MARGIN = 1.0
"""m/s² more than the engine alone before it counts as deploying: the speed trace is noisy and
K_POWER and MASS are estimates."""

DEPLOY_MIN_SPEED = 200.0
"""km/h: slower, grip limits the acceleration with or without the battery, so the data cannot
tell whether it deploys."""

COAST = 60.0
"""Metres from lift to brake from which it is lift and coast (going from throttle to brake
takes ~30 m at 300 km/h)."""

LATERAL_MAX = 10.0
"""m/s² (~1 g): above this the car is cornering (Curva Grande, Raidillon, Blanchimont). There
grip and drag set the speed, not the power, so it is not judged: such a stretch is neither
clipping nor in the envelope, and a projection does there what the lap did."""

CURVATURE_WINDOW = 30.0
"""Curvature from the positions ±this many metres away."""

GRADIENT_WINDOW = 50.0
"""The slope is the height change over ±this many metres (z is noisy sample to sample)."""

G = 9.81
KMH = 3.6


@dataclass(frozen=True)
class Kinematics:
    """A lap on a uniform time grid. With the previous lap's tail the distance starts negative."""

    distance: np.ndarray
    time: np.ndarray
    speed: np.ndarray
    """km/h"""
    full: np.ndarray
    """Full throttle, no brake, no hole in the data."""
    brake: np.ndarray
    gear: np.ndarray
    """The gear of the last sample (0 without a gear channel)."""
    slope: np.ndarray
    """Height gained per metre. Uphill a car accelerates g × slope less on the same power."""
    lateral: np.ndarray
    """Sideways acceleration (m/s², from the curvature of the line)."""
    length: float
    """The lap's own length (m): runs ending this close to it are cut by the line."""


@dataclass(frozen=True)
class Run:
    """One full-throttle run: points [start, end) of the grid and its acceleration."""

    start: int
    end: int
    accel: np.ndarray
    """m/s² per point of the run."""
    judged: np.ndarray
    """Not cornering (lateral below LATERAL_MAX): only there acceleration says something about
    deployment."""


def _shifted(trace: LapTrace, distance: float, time: float) -> dict[str, np.ndarray]:
    ch = trace.channels
    return {
        "distance": trace.distance + distance,
        "time": trace.time + time,
        "speed": ch["speed"],
        "throttle": ch["throttle"],
        "brake": ch["brake"],
        "gear": ch["gear"] if "gear" in ch else np.zeros(trace.distance.size),
        **{
            axis: ch[axis] / POSITION_UNITS_PER_METRE
            if axis in ch
            else np.zeros(trace.distance.size)
            for axis in ("x", "y", "z")
        },
    }


def kinematics(trace: LapTrace, previous: LapTrace | None = None) -> Kinematics:
    parts = [_shifted(trace, 0.0, 0.0)]
    if previous is not None and len(previous.distance) > 1:
        tail = _shifted(previous, -previous.length, -float(previous.time[-1]))
        keep = tail["distance"] > -PREVIOUS_TAIL
        parts.insert(0, {k: v[keep] for k, v in tail.items()})
    raw = {k: np.concatenate([p[k] for p in parts]) for k in parts[0]}
    t = raw["time"]
    keep = np.concatenate(([True], np.diff(t) > 0))
    raw = {k: v[keep] for k, v in raw.items()}
    t = raw["time"]

    grid = np.arange(t[0], t[-1] + 1e-9, DT)
    sample = np.clip(np.searchsorted(t, grid, side="right") - 1, 0, len(t) - 1)
    brake = raw["brake"][sample] > 0
    throttle = np.interp(grid, t, raw["throttle"])

    # A hole in the data: the speed in between is a straight line drawn by the interpolation.
    gaps = np.diff(t) > DATA_GAP
    hole = np.zeros(grid.size, dtype=bool)
    if gaps.any():
        inside = sample < len(t) - 1
        hole[inside] = gaps[sample[inside]]

    throttle_ok = throttle >= THROTTLE_FULL
    full = _close_short(throttle_ok, brake | hole, round(THROTTLE_GLITCH / DT)) & ~brake & ~hole
    distance = np.interp(grid, t, raw["distance"])
    speed = np.interp(grid, t, raw["speed"])
    # Positions by distance (sorted: a standing car repeats its distance).
    order = np.argsort(raw["distance"], kind="stable")
    along = raw["distance"][order]

    def at(offset: float, axis: str) -> np.ndarray:
        return np.interp(distance + offset, along, raw[axis][order])

    w = GRADIENT_WINDOW
    slope = (at(w, "z") - at(-w, "z")) / (2 * w)
    c = CURVATURE_WINDOW
    behind = np.stack([at(-c, "x"), at(-c, "y")])
    here = np.stack([at(0.0, "x"), at(0.0, "y")])
    ahead = np.stack([at(c, "x"), at(c, "y")])
    return Kinematics(
        distance=distance,
        time=grid,
        speed=speed,
        full=full,
        brake=brake,
        gear=raw["gear"][sample],
        slope=slope,
        lateral=(speed / KMH) ** 2 * _curvature(behind, here, ahead),
        length=trace.length,
    )


def _curvature(p: np.ndarray, q: np.ndarray, r: np.ndarray) -> np.ndarray:
    """1/radius of the circle through three points (Menger curvature), per column."""
    u, w = q - p, r - q
    cross = np.abs(u[0] * w[1] - u[1] * w[0])
    sides = np.hypot(*u) * np.hypot(*w) * np.hypot(*(r - p))
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(sides > 0, 2 * cross / sides, 0.0)


def _close_short(mask: np.ndarray, blocked: np.ndarray, width: int) -> np.ndarray:
    """Fill False stretches of at most `width` points between two True ones, unless blocked."""
    out = mask.copy()
    edges = np.flatnonzero(np.diff(mask.astype(np.int8)))
    # Falling edge (True -> False) followed by a rising edge within `width` points.
    for fall, rise in zip(edges[:-1], edges[1:], strict=False):
        if mask[fall] and rise - fall <= width and not blocked[fall + 1 : rise + 1].any():
            out[fall + 1 : rise + 1] = True
    return out


def runs(k: Kinematics) -> list[Run]:
    """Full-throttle runs of at least MIN_STRAIGHT, each with its own acceleration."""
    edges = np.flatnonzero(np.diff(np.concatenate(([0], k.full.astype(np.int8), [0]))))
    out = []
    for start, end in zip(edges[::2], edges[1::2], strict=True):
        if k.distance[end - 1] - k.distance[start] >= MIN_STRAIGHT:
            out.append(
                Run(
                    start=int(start),
                    end=int(end),
                    accel=_accel(k, start, end),
                    judged=k.lateral[start:end] < LATERAL_MAX,
                )
            )
    return out


def _accel(k: Kinematics, start: int, end: int) -> np.ndarray:
    """dv/dt as the slope of a straight line through the speed over ±HALF_WINDOW, the window cut
    to the run (so the lift never counts), as on the flat: plus g × slope, so a climb is not
    taken for clipping. A fit through every point is less noisy than a difference of two."""
    n = round(HALF_WINDOW / DT)
    t = k.time[start:end] - k.time[start]
    v = k.speed[start:end] / KMH

    def sums(values: np.ndarray) -> np.ndarray:
        return np.concatenate(([0.0], np.cumsum(values)))

    i = np.arange(t.size)
    lo, hi = np.maximum(i - n, 0), np.minimum(i + n, t.size - 1) + 1
    count = hi - lo
    st, sv, stt, stv = (sums(x)[hi] - sums(x)[lo] for x in (t, v, t * t, t * v))
    spread = stt - st * st / count
    with np.errstate(invalid="ignore", divide="ignore"):
        accel = np.where(spread > 1e-9, (stv - st * sv / count) / spread, 0.0)
    return accel + G * k.slope[start:end]


@dataclass(frozen=True)
class Envelope:
    """The best acceleration seen per speed: full deployment, as far as the session showed."""

    speed: np.ndarray
    """km/h, bin centres."""
    accel: np.ndarray
    """m/s² per bin."""
    _tables: dict[float, tuple[np.ndarray, np.ndarray, np.ndarray]] = field(
        default_factory=dict, init=False, repr=False, compare=False
    )

    def at(self, speed: np.ndarray | float) -> np.ndarray:
        """Between bins interpolated, beyond the ends the nearest bin."""
        return np.interp(speed, self.speed, self.accel)

    def project(self, speed: float, distance: float, slope: float = 0.0) -> tuple[float, float]:
        """Follow the envelope from `speed` (km/h) for `distance` (m) up a `slope` (height per
        metre): the speed at the end (km/h) and the time it takes (s). Never faster than the
        envelope's top speed: above the highest speed seen on a straight nothing says what the
        car could do."""
        if distance <= 0:
            return speed, 0.0
        u, d, t = self._table(round(G * slope, 1))
        if speed >= u[-1]:
            return speed, distance / (speed / KMH)
        d0 = float(np.interp(speed, u, d))
        target = d0 + distance
        if target <= d[-1]:
            v1 = float(np.interp(target, d, u))
            return v1, float(np.interp(v1, u, t) - np.interp(speed, u, t))
        top = float(u[-1])
        return top, float(t[-1] - np.interp(speed, u, t)) + (target - d[-1]) / (top / KMH)

    def _table(self, climb: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Speed u (km/h) and the distance and time to reach it from LOW_SPEED, with `climb`
        (m/s², g × slope) less acceleration.

        dv/dx = a/v, so the distance to accelerate is the integral of v/a dv and the time the
        integral of 1/a dv; both stop where the acceleration falls to TOP_ACCEL (top speed).
        """
        if climb in self._tables:
            return self._tables[climb]
        u = np.arange(min(LOW_SPEED, self.speed[0]), self.speed[-1] + 1e-9, 0.25)
        a = self.at(u) - climb
        stop = np.flatnonzero(a <= TOP_ACCEL)
        if stop.size:
            u, a = u[: max(stop[0], 2)], a[: max(stop[0], 2)]
        a = np.maximum(a, TOP_ACCEL)
        v = u / KMH
        dv = np.diff(v)
        d = np.concatenate(([0.0], np.cumsum(dv * (v[1:] / a[1:] + v[:-1] / a[:-1]) / 2)))
        t = np.concatenate(([0.0], np.cumsum(dv * (1 / a[1:] + 1 / a[:-1]) / 2)))
        self._tables[climb] = (u, d, t)
        return u, d, t


@dataclass(frozen=True)
class Profile:
    """One lap on one straight, reduced for an envelope: its median acceleration per speed bin
    (that averages out the noise of whole km/h at 4 Hz)."""

    bins: np.ndarray
    """Bin numbers (speed // SPEED_BIN), ascending."""
    accel: np.ndarray
    top: float
    """Highest speed (km/h)."""


def profile(speed: np.ndarray, accel: np.ndarray) -> Profile | None:
    if speed.size == 0:
        return None
    which = np.floor(speed / SPEED_BIN).astype(int)
    order = np.lexsort((accel, which))
    which, accel = which[order], accel[order]
    bins, starts, counts = np.unique(which, return_index=True, return_counts=True)
    low = starts + (counts - 1) // 2
    high = starts + counts // 2
    return Profile(bins=bins, accel=(accel[low] + accel[high]) / 2, top=float(speed.max()))


def envelope(profiles: list[Profile]) -> Envelope | None:
    """Per speed bin the PERCENTILE of the laps' medians: what the best laps managed at that
    speed. A bin needs MIN_LAPS laps (fewer if there are fewer). The top bin ends at the highest
    speed seen: above it nothing says what a car could do. None with fewer than two bins.

    One straight's envelope never borrows from other straights: a long straight where nobody
    can deploy all the way (Baku) would get the acceleration of a short one at the same speed.
    """
    if not profiles:
        return None
    which = np.concatenate([p.bins for p in profiles])
    accel = np.concatenate([p.accel for p in profiles])
    order = np.argsort(which, kind="stable")
    which, accel = which[order], accel[order]
    bins, starts, counts = np.unique(which, return_index=True, return_counts=True)
    keep = counts >= min(MIN_LAPS, len(profiles))
    if keep.sum() < 2:
        return None
    centres = (bins[keep] + 0.5) * SPEED_BIN
    centres[-1] = min(centres[-1], max(p.top for p in profiles))
    groups = zip(starts[keep], counts[keep], strict=True)
    values = np.array([np.percentile(accel[a : a + n], PERCENTILE) for a, n in groups])
    return Envelope(speed=centres, accel=values)


@dataclass(frozen=True)
class Straight:
    """One lap on one straight. Distances are the lap's own (negative = before the line)."""

    corner: str
    """The corner it brakes for."""
    after: str
    """The corner it starts from."""
    start: float
    end: float
    """Where full throttle ends: the lift or the brake."""
    coast: float
    """Metres from the lift to the brake when that is at least COAST (lift and coast), else 0."""
    entry_speed: float
    peak_speed: float
    peak_at: float
    end_speed: float
    clip_at: float | None
    """Where the car first stops gaining speed at full throttle while the envelope says it could
    (None if that never costs MIN_GAIN)."""
    clipping: list[tuple[float, float]]
    """Every stretch like that, from clip_at on (it can gain again in between)."""
    clip_cost_speed: float
    """km/h more at `end` following the envelope from clip_at."""
    clip_cost_time: float
    downshifts: list[tuple[float, int, float]] = field(default_factory=list)
    """Downshifts at full throttle: (distance, gear after, km/h)."""
    deploying: list[tuple[float, float]] = field(default_factory=list)
    """Stretches gaining more than the engine alone could (the MGU-K deploying)."""

    @property
    def clipped(self) -> float:
        """Metres at full throttle without gaining speed, all stretches together."""
        return sum(b - a for a, b in self.clipping)


def corner_after(corners: list[tuple[str, float]], distance: float) -> str | None:
    """The first corner at or after `distance` (allowing CORNER_SLACK), None past the last."""
    for label, at in corners:
        if at >= distance - CORNER_SLACK:
            return label
    return None


def corner_before(corners: list[tuple[str, float]], distance: float) -> str:
    """The last corner before `distance`; before the first one, the last of the lap."""
    before = [label for label, at in corners if at < distance + CORNER_SLACK]
    return before[-1] if before else corners[-1][0]


def _cut(k: Kinematics, run: Run) -> bool:
    return (
        run.end >= len(k.distance) - 1 or float(k.distance[run.end - 1]) >= k.length - CORNER_SLACK
    )


def straights(
    k: Kinematics, corners: list[tuple[str, float]], found: list[Run] | None = None
) -> list[tuple[str, str, Run]]:
    """The lap's runs that brake for a corner, as (corner, after, run). `corners` are (label,
    distance) on this lap's scale, sorted. A run cut by the line belongs to the next lap; with
    two runs into one corner (a lift on the way) the last one counts. `found`: runs(k), if
    already known."""
    out: dict[str, tuple[str, str, Run]] = {}
    for run in runs(k) if found is None else found:
        end = float(k.distance[run.end - 1])
        if _cut(k, run):
            continue
        corner = corner_after(corners, end)
        if corner is None:
            continue
        out[corner] = (corner, corner_before(corners, float(k.distance[run.start])), run)
    return list(out.values())


def across_line(k: Kinematics, found: list[Run]) -> Run | None:
    """The run cut by the line (full throttle into the next lap), if any: the next lap judges
    it, but its deploy belongs to the end of this one."""
    return found[-1] if found and _cut(k, found[-1]) else None


def downshifts(k: Kinematics, run: Run) -> list[tuple[float, int, float]]:
    """Downshifts at full throttle faster than MIN_DOWNSHIFT_SPEED, as (distance, gear after,
    km/h). The gear channel lags the rpm by ~0.2 s, so the shift itself began ~15 m earlier."""
    gear = k.gear[run.start : run.end]
    speed = k.speed[run.start : run.end]
    at = np.flatnonzero((gear[1:] < gear[:-1]) & (gear[1:] > 0) & (speed[1:] > MIN_DOWNSHIFT_SPEED))
    return [
        (float(k.distance[run.start + i + 1]), int(gear[i + 1]), float(speed[i + 1])) for i in at
    ]


def deploy(k: Kinematics, run: Run, reference: Envelope) -> np.ndarray:
    """Per point of the run its acceleration as % of the envelope at its speed (of at least
    DEPLOY_MIN_ENVELOPE); NaN where it is not judged (cornering)."""
    best = np.maximum(reference.at(k.speed[run.start : run.end]), DEPLOY_MIN_ENVELOPE)
    share = np.clip(100.0 * run.accel / best, *DEPLOY_RANGE)
    judged = run.judged & ~_short(run.judged, round(DEPLOY_MIN_STRETCH / DT))
    return np.where(judged, share, np.nan)


def engine_only(full: Envelope, speed: np.ndarray) -> np.ndarray:
    """m/s² the engine alone would give at `speed` (km/h): `full` (the session's envelope over
    all straights, full deployment) less what the MGU-K adds at that speed."""
    v = np.maximum(speed / KMH, 1.0)
    return full.at(speed) - K_POWER / (MASS * v)


def deploying(k: Kinematics, run: Run, full: Envelope) -> np.ndarray:
    """Per point of the run: gaining clearly more than the engine alone could (at least FLAT),
    where power sets the acceleration. An estimate: the mass and the MGU-K's power are assumed."""
    speed = k.speed[run.start : run.end]
    floor = np.maximum(engine_only(full, speed) + DEPLOY_MARGIN, FLAT)
    return run.judged & (speed >= DEPLOY_MIN_SPEED) & (run.accel > floor)


def deploying_stretches(k: Kinematics, run: Run, full: Envelope) -> list[tuple[int, int]]:
    """Where the run deploys as [start, end) indices into the run, as the map and the Deploy
    channel show it: `deploying` over at least MIN_CLIP metres."""
    return _stretches(deploying(k, run, full), k.distance[run.start : run.end])


def _short(mask: np.ndarray, width: int) -> np.ndarray:
    """The True stretches of `mask` shorter than `width` points."""
    edges = np.flatnonzero(np.diff(np.concatenate(([0], mask.astype(np.int8), [0]))))
    out = np.zeros_like(mask)
    for start, end in zip(edges[::2], edges[1::2], strict=True):
        if end - start < width:
            out[start:end] = True
    return out


def samples(run: Run, k: Kinematics) -> Profile | None:
    """A run where it is judged, for an envelope."""
    return profile(k.speed[run.start : run.end][run.judged], run.accel[run.judged])


def follow(reference: Envelope, run: Run, k: Kinematics, first: int) -> tuple[float, float]:
    """A car following the envelope from point `first` of the run to its end: speed at the end
    (km/h) and the time it takes (s). Where the lap is cornering it changes v² as the lap did
    (no gain or loss there); on the judged parts it follows the envelope, up the same hill."""
    s = run.start
    d, v = k.distance[s : run.end], k.speed[s : run.end]
    bounds = np.flatnonzero(np.diff(run.judged[first:].astype(np.int8))) + first + 1
    edges = [first, *bounds.tolist(), len(d) - 1]
    speed, time = float(v[first]), 0.0
    for i, j in zip(edges[:-1], edges[1:], strict=True):
        if j <= i:
            continue
        if run.judged[i]:
            climb = float(np.mean(k.slope[s + i : s + j + 1]))
            speed, dt = reference.project(speed, float(d[j] - d[i]), climb)
        else:
            v2 = np.maximum(speed**2 + v[i : j + 1] ** 2 - v[i] ** 2, 1.0)
            dt = float(np.trapezoid(KMH / np.sqrt(v2), d[i : j + 1]))
            speed = float(np.sqrt(v2[-1]))
        time += dt
    return speed, time


def _coast(k: Kinematics, end: int) -> float:
    lift = k.distance[end - 1]
    ahead = np.flatnonzero(k.brake[end - 1 :] & (k.distance[end - 1 :] <= lift + BRAKE_SEARCH))
    if ahead.size == 0:
        return 0.0
    coast = float(k.distance[end - 1 + ahead[0]] - lift)
    return coast if coast >= COAST else 0.0


def _stretches(mask: np.ndarray, distance: np.ndarray) -> list[tuple[int, int]]:
    """Runs of True as [start, end) of at least MIN_CLIP metres, over glitches of a sample."""
    mask = _close_short(mask, np.zeros_like(mask), round(THROTTLE_GLITCH / DT))
    edges = np.flatnonzero(np.diff(np.concatenate(([0], mask.astype(np.int8), [0]))))
    return [
        (int(s), int(e))
        for s, e in zip(edges[::2], edges[1::2], strict=True)
        if distance[e - 1] - distance[s] >= MIN_CLIP
    ]


def analyse(
    k: Kinematics,
    corner: str,
    after: str,
    run: Run,
    reference: Envelope | None,
    full: Envelope | None = None,
) -> Straight:
    """One straight of one lap against the straight's envelope (None: only what was measured),
    and where it deploys against `full`, the session's envelope over all straights."""
    s, e = run.start, run.end
    d, t, v = k.distance[s:e], k.time[s:e], k.speed[s:e]
    peak = int(np.argmax(v))
    clip_at, clipping, clip_speed, clip_time = None, [], 0.0, 0.0
    deploys = (
        []
        if full is None
        else [(float(d[a]), float(d[b - 1])) for a, b in deploying_stretches(k, run, full)]
    )

    if reference is not None:
        # Not gaining, where the best on this straight still gained CLIP_MARGIN more.
        gap = reference.at(v) - run.accel
        stuck = (run.accel < FLAT) & (gap >= CLIP_MARGIN) & run.judged
        stretches = _stretches(stuck, d)
        if stretches:
            first = stretches[0][0]
            v1, time = follow(reference, run, k, first)
            if v1 - v[-1] >= MIN_GAIN:
                clip_at = float(d[first])
                clipping = [(float(d[a]), float(d[b - 1])) for a, b in stretches]
                clip_speed = float(v1 - v[-1])
                clip_time = max(float(t[-1] - t[first]) - time, 0.0)

    return Straight(
        corner=corner,
        after=after,
        start=float(d[0]),
        end=float(d[-1]),
        coast=_coast(k, e),
        entry_speed=float(v[0]),
        peak_speed=float(v[peak]),
        peak_at=float(d[peak]),
        end_speed=float(v[-1]),
        clip_at=clip_at,
        clipping=clipping,
        deploying=deploys,
        clip_cost_speed=clip_speed,
        clip_cost_time=clip_time,
        downshifts=downshifts(k, run),
    )
