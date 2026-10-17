"""Pure lap-analysis maths: resampling onto a distance grid, delta time and mini-sectors.

Laps are aligned by stretching each lap onto the reference lap's length. Drivers take slightly
different lines (a few metres per lap), and stretching keeps the end-of-lap delta equal to the
lap-time difference instead of comparing at a distance the slower line hasn't reached.
"""

from dataclasses import dataclass

import numpy as np

STEP_CHANNELS = frozenset({"gear", "brake", "drs"})
"""Discrete channels: take the last sample instead of interpolating (no gear 6.5)."""


@dataclass(frozen=True)
class LapTrace:
    distance: np.ndarray
    """Metres from the start of the lap, non-decreasing."""
    time: np.ndarray
    """Seconds from the start of the lap; the last sample equals the lap time."""
    channels: dict[str, np.ndarray]

    @property
    def length(self) -> float:
        return float(self.distance[-1])


@dataclass(frozen=True)
class Resampled:
    time: np.ndarray
    channels: dict[str, np.ndarray]


@dataclass(frozen=True)
class Comparison:
    distance: np.ndarray
    laps: list[Resampled]
    deltas: list[np.ndarray]
    """Per lap: time behind the reference lap (first lap) at each grid point; positive = slower."""


@dataclass(frozen=True)
class MiniSectors:
    boundaries: np.ndarray
    times: np.ndarray
    """Shape (laps, sectors): time spent in each mini-sector."""
    fastest: np.ndarray
    """Per mini-sector: index of the lap that was quickest."""


def make_grid(length: float, step: float) -> np.ndarray:
    grid = np.arange(0.0, length, step)
    return np.append(grid, length)


def resample(trace: LapTrace, grid: np.ndarray, length: float) -> Resampled:
    keep = np.concatenate(([True], np.diff(trace.distance) > 0))
    distance = trace.distance[keep] * (length / trace.length)
    time = np.interp(grid, distance, trace.time[keep])

    last_sample = np.clip(np.searchsorted(distance, grid, side="right") - 1, 0, len(distance) - 1)
    channels = {}
    for name, values in trace.channels.items():
        values = values[keep]
        if name in STEP_CHANNELS:
            channels[name] = values[last_sample]
        else:
            channels[name] = np.interp(grid, distance, values)
    return Resampled(time=time, channels=channels)


def compare(traces: list[LapTrace], step: float = 5.0) -> Comparison:
    if not traces:
        raise ValueError("Need at least one lap to compare")
    length = traces[0].length
    grid = make_grid(length, step)
    laps = [resample(trace, grid, length) for trace in traces]
    deltas = [lap.time - laps[0].time for lap in laps]
    return Comparison(distance=grid, laps=laps, deltas=deltas)


def mini_sectors(comparison: Comparison, count: int) -> MiniSectors:
    if count < 1:
        raise ValueError("Need at least one mini-sector")
    grid = comparison.distance
    boundaries = np.linspace(0.0, grid[-1], count + 1)
    times = np.array([np.diff(np.interp(boundaries, grid, lap.time)) for lap in comparison.laps])
    return MiniSectors(boundaries=boundaries, times=times, fastest=np.argmin(times, axis=0))
