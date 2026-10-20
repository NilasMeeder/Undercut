"""Pace changes: where a driver's lap times step to another level within a stint or a run (a car
it caught, one it got free of, a set that went off). Pure; the report (and through it the alerts
and the automatic markers), the forecast and the long runs use it."""

from dataclasses import dataclass

import numpy as np

from app.schemas import DriverRace, RaceHistory

WINDOW = 5
"""Clean laps on either side of a pace change, in the same stint."""

STEP = 0.7
"""Seconds a lap, against the field, from which a driver's pace changed."""

SIGNIFICANCE = 3.0
"""The step in standard deviations of the laps around the fit: smaller is the usual noise."""

OUTLIER = 1.0
"""A lap further than this (s) from the median of the five around it (traffic, a mistake)."""

FIELD_LAPS = 5
"""Clean laps of a lap number needed for the field's median (the reference of a pace change)."""

CLOSE = 1.2
"""Seconds behind the car ahead at which it holds you up."""


@dataclass
class PaceChange:
    driver: str
    lap: int
    """First lap at the new pace."""
    before: int
    """The last clean lap before it."""
    step: float
    """Seconds a lap, negative = quicker (medians of the WINDOW laps before and after)."""
    other: str | None
    """The car it caught (slower) or got free of (quicker)."""
    started: float
    """Line time of the lap before: where the change begins."""
    known: float
    """Line time of the WINDOW-th lap at the new pace: from then on it shows."""


def _sse(columns: list[np.ndarray], y: np.ndarray) -> tuple[np.ndarray, float]:
    coef, *_ = np.linalg.lstsq(np.column_stack(columns), y, rcond=None)
    residual = y - np.column_stack(columns) @ coef
    return coef, float(residual @ residual)


def step(laps: list[int], times: list[float], window: int = WINDOW) -> tuple[int, float] | None:
    """Where a run of lap times steps to another level, and by how much.

    A line with a step in it against the run's own trend (degradation, fuel, a track that
    rubbers in stay in the slope): the break with the smallest residual, if the step is at
    least STEP, SIGNIFICANCE times the noise around the fit, and the `window` laps before and
    after it (medians) differ as much in the same direction. Returns the first lap at the new
    pace and the step (s/lap, negative = quicker)."""
    x, y = np.asarray(laps, float), np.asarray(times, float)
    around = np.array([np.median(y[max(0, i - 2) : i + 3]) for i in range(len(y))])
    keep = np.abs(y - around) <= OUTLIER
    x, y = x[keep], y[keep]
    w = window
    if len(x) < 2 * w:
        return None
    base = [np.ones_like(x), x]
    best: tuple[int, float, float] | None = None
    for i in range(w, len(x) - w + 1):
        coef, sse = _sse([*base, (np.arange(len(x)) >= i).astype(float)], y)
        if best is None or sse < best[1]:
            best = (i, sse, float(coef[2]))
    assert best is not None
    i, sse, size = best
    noise = np.sqrt(sse / (len(x) - 3))
    local = float(np.median(y[i : i + w]) - np.median(y[i - w : i]))
    if abs(size) < STEP or abs(size) < SIGNIFICANCE * noise:
        return None
    if abs(local) < STEP or np.sign(local) != np.sign(size):
        return None
    return int(x[i]), round(local, 2)


def _gap(d: DriverRace, lap: int) -> float | None:
    if lap in d.laps:
        return d.gap[d.laps.index(lap)]
    return None


def _ahead(history: RaceHistory, me: DriverRace, lap: int) -> tuple[str, float] | None:
    """The car ahead on the same lap at its end and the interval to it (from the gaps)."""
    mine = _gap(me, lap)
    if mine is None:
        return None
    ahead = [
        (d.driver, mine - theirs)
        for d in history.drivers
        if d.driver != me.driver and (theirs := _gap(d, lap)) is not None and theirs < mine
    ]
    return min(ahead, key=lambda a: a[1], default=None)


def _cause(history: RaceHistory, d: DriverRace, lap: int, size: float) -> str | None:
    """Slower behind a car it caught, or quicker once free of the car that held it up."""
    if size > 0:
        held = [_ahead(history, d, n) for n in (lap, lap + 1, lap + 2)]
        cars = [a[0] for a in held if a is not None and a[1] <= CLOSE]
        return cars[0] if len(cars) >= 2 and cars.count(cars[0]) >= 2 else None
    before = _ahead(history, d, lap - 1)
    if before is None or before[1] > CLOSE:
        return None
    after = _ahead(history, d, lap + 1)
    free = after is None or after[0] != before[0] or after[1] > 2 * CLOSE
    return before[0] if free else None


def changes(history: RaceHistory) -> list[PaceChange]:
    """Every pace change within a stint (`step`), against the field's median on each lap (fuel,
    track and weather are the same for everyone)."""
    on_lap: dict[int, list[float]] = {}
    for d in history.drivers:
        for lap, time, clean in zip(d.laps, d.lap_time, d.clean, strict=True):
            if clean and time is not None:
                on_lap.setdefault(lap, []).append(time)
    field = {lap: float(np.median(v)) for lap, v in on_lap.items() if len(v) >= FIELD_LAPS}
    out = []
    for d in history.drivers:
        for stint in d.stints:
            laps, rel = [], []
            for lap, time, clean in zip(d.laps, d.lap_time, d.clean, strict=True):
                if stint.start_lap <= lap <= stint.end_lap and clean and time and lap in field:
                    laps.append(lap)
                    rel.append(time - field[lap])
            found = step(laps, rel)
            if found is None:
                continue
            lap, size = found
            started = d.line[d.laps.index(lap - 1)] if lap - 1 in d.laps else None
            fifth = [n for n in laps if n >= lap][WINDOW - 1]
            known = d.line[d.laps.index(fifth)]
            if started is None or known is None:
                continue
            out.append(
                PaceChange(
                    driver=d.driver,
                    lap=lap,
                    before=max((n for n in laps if n < lap), default=lap - 1),
                    step=size,
                    other=_cause(history, d, lap, size),
                    started=started,
                    known=known,
                )
            )
    return out
