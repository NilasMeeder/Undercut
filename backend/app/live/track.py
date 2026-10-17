"""The position track of a live session, grown as Position.z messages come in.

Same grid and meaning as the replay's track (replay.build_track): x, y and progress in laps driven
every TRACK_STEP seconds, NaN where a car is not on track. The replay takes progress from each
lap's distance; live the lap is not finished, so progress = laps completed (TimingData
NumberOfLaps, by the time it was sent) + where the car is along the circuit outline.
"""

import math
from bisect import bisect_right
from dataclasses import dataclass, field

import numpy as np

from app.replay import MAX_SAMPLE_GAP, TRACK_STEP, Track

LAG = 1.0
"""Seconds the grid stays behind the newest sample: later samples can still bracket a point."""
LINE_SLACK = 20.0
"""Seconds after a lap count went up in which a car still before the line has not crossed it
(the count can come a moment before the position)."""


@dataclass
class Outline:
    """The circuit as a closed polyline with the lap distance (m) of every point."""

    x: np.ndarray
    y: np.ndarray
    distance: np.ndarray
    length: float

    def fraction(self, px: np.ndarray, py: np.ndarray) -> np.ndarray:
        """Lap fraction (0-1) of each point, from the nearest point on the outline."""
        ax, ay = self.x, self.y
        bx, by = np.roll(ax, -1), np.roll(ay, -1)
        da, db = self.distance, np.roll(self.distance, -1)
        db = np.where(db < da - self.length / 2, db + self.length, db)  # across the line
        sx, sy = bx - ax, by - ay
        seg = np.maximum(sx * sx + sy * sy, 1e-9)
        # points x segments
        u = ((px[:, None] - ax) * sx + (py[:, None] - ay) * sy) / seg
        u = np.clip(u, 0.0, 1.0)
        dx = ax + u * sx - px[:, None]
        dy = ay + u * sy - py[:, None]
        nearest = np.argmin(dx * dx + dy * dy, axis=1)
        rows = np.arange(len(px))
        d = da[nearest] + u[rows, nearest] * (db[nearest] - da[nearest])
        return np.mod(d, self.length) / self.length


@dataclass
class _Car:
    t: list[float] = field(default_factory=list)
    x: list[float] = field(default_factory=list)
    y: list[float] = field(default_factory=list)
    on: list[bool] = field(default_factory=list)
    laps_t: list[float] = field(default_factory=list)
    laps_n: list[int] = field(default_factory=list)
    grid_x: list[float] = field(default_factory=list)
    grid_y: list[float] = field(default_factory=list)
    grid_p: list[float] = field(default_factory=list)


class LiveTrack:
    def __init__(self, step: float = TRACK_STEP):
        self.step = step
        self.start: float | None = None
        self.count = 0
        self.newest = -math.inf
        self.cars: dict[str, _Car] = {}

    def add_position(self, t: float, car: str, x: float, y: float, on_track: bool) -> None:
        own = self.cars.setdefault(car, _Car())
        if own.t and t <= own.t[-1]:
            return  # duplicate or out of order
        own.t.append(t)
        own.x.append(x)
        own.y.append(y)
        own.on.append(on_track)
        self.newest = max(self.newest, t)
        if self.start is None:
            self.start = math.floor(t)

    def add_lap_count(self, t: float, car: str, laps: int) -> None:
        own = self.cars.setdefault(car, _Car())
        if own.laps_n and laps <= own.laps_n[-1]:
            return
        own.laps_t.append(t)
        own.laps_n.append(laps)

    def extend(self, outline: Outline | None) -> int:
        """Fill the grid up to LAG before the newest sample; returns the index of the first new
        point (== the old count)."""
        first = self.count
        if self.start is None:
            return first
        until = int((self.newest - LAG - self.start) / self.step) + 1
        if until <= first:
            return first
        grid = self.start + self.step * np.arange(first, until)
        for own in self.cars.values():
            x, y, progress = self._resample(own, grid, outline)
            # Cars that showed up later are padded so every car has `count` points.
            missing = first - len(own.grid_x)
            if missing > 0:
                own.grid_x += [math.nan] * missing
                own.grid_y += [math.nan] * missing
                own.grid_p += [math.nan] * missing
            own.grid_x += x.tolist()
            own.grid_y += y.tolist()
            own.grid_p += progress.tolist()
        self.count = until
        return first

    def _resample(
        self, own: _Car, grid: np.ndarray, outline: Outline | None
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        empty = np.full(len(grid), np.nan)
        if len(own.t) < 2:
            return empty, empty.copy(), empty.copy()
        # Only the samples around the new stretch of grid.
        lo = max(bisect_right(own.t, grid[0] - MAX_SAMPLE_GAP) - 1, 0)
        t = np.asarray(own.t[lo:])
        on = np.asarray(own.on[lo:])
        j = np.searchsorted(t, grid, side="right") - 1
        inside = (j >= 0) & (j < len(t) - 1)
        j = np.clip(j, 0, max(len(t) - 2, 0))
        t0, t1 = t[j], t[np.minimum(j + 1, len(t) - 1)]
        span = t1 - t0
        f = np.divide(grid - t0, span, out=np.zeros_like(grid), where=span > 0)
        valid = inside & (span <= MAX_SAMPLE_GAP) & on[j]
        out = []
        for values in (own.x, own.y):
            v = np.asarray(values[lo:])
            nxt = v[np.minimum(j + 1, len(v) - 1)]
            res = v[j] + f * (nxt - v[j])
            res[~valid] = np.nan
            out.append(res)
        x, y = out
        progress = np.full(len(grid), np.nan)
        if outline is not None and valid.any():
            frac = outline.fraction(x[valid], y[valid])
            progress[valid] = [
                self._laps_at(own, at, fr) for at, fr in zip(grid[valid], frac, strict=True)
            ]
        return x, y, progress

    @staticmethod
    def _laps_at(own: _Car, t: float, fraction: float) -> float:
        i = bisect_right(own.laps_t, t) - 1
        done = own.laps_n[i] if i >= 0 else 0
        crossed = own.laps_t[i] if i >= 0 else -math.inf
        progress = done + fraction
        # Just before the line: on the grid before the start, or the count came a moment early.
        if fraction > 0.75 and (done == 0 or t - crossed < LINE_SLACK):
            progress -= 1
        return progress

    def snapshot(self, codes: dict[str, str], first: int = 0) -> list[dict]:
        """Cars as the positions response has them, from grid point `first` on."""
        cars = []
        for number, own in sorted(self.cars.items(), key=lambda item: codes.get(item[0], "")):
            code = codes.get(number)
            if code is None:
                continue
            pad = max(self.count - len(own.grid_x), 0)
            xs = (own.grid_x + [math.nan] * pad)[first : self.count]
            ys = (own.grid_y + [math.nan] * pad)[first : self.count]
            ps = (own.grid_p + [math.nan] * pad)[first : self.count]
            cars.append(
                {
                    "driver": code,
                    "x": [None if math.isnan(v) else round(v) for v in xs],
                    "y": [None if math.isnan(v) else round(v) for v in ys],
                    "progress": [None if math.isnan(v) else round(v, 4) for v in ps],
                }
            )
        return cars

    def to_track(self, codes: dict[str, str], outline: Outline) -> Track:
        """As the replay's track, to keep after the session (replays.save_track)."""
        cars = [(codes[n], own) for n, own in self.cars.items() if n in codes]
        cars.sort(key=lambda item: item[0])

        def rows(name: str) -> np.ndarray:
            out = np.full((len(cars), self.count), np.nan)
            for i, (_, own) in enumerate(cars):
                values = getattr(own, name)[: self.count]
                out[i, : len(values)] = values
            return out

        return Track(
            start=float(self.start or 0.0),
            step=self.step,
            lap_length=outline.length,
            drivers=[code for code, _ in cars],
            x=rows("grid_x"),
            y=rows("grid_y"),
            progress=rows("grid_p"),
        )
