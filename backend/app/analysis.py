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


LENGTH_SLACK = 0.005
"""A lap whose telemetry is longer or shorter than a normal lap by more than this share has a
hole or a glitch in its distance (Monza 2026 Q, GAS L17: 110 m too long), or went another way
(the pit lane). Stretched onto another lap, its corners land in the wrong place."""


def length_off(length: float, typical: float | None) -> float | None:
    """Metres longer (+) or shorter (-) than a typical lap, when that is more than LENGTH_SLACK;
    else None."""
    if typical is None or typical <= 0 or abs(length / typical - 1) <= LENGTH_SLACK:
        return None
    return length - typical


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


THROTTLE_FULL = 95.0
"""Throttle (%) from which a driver counts as back on full throttle."""

CHICANE_GAP = 150.0
"""Corners closer than this (m) always form one segment: a chicane, even with a dab of brake."""

MERGE_GAP = 400.0
"""Corners closer than this (m) without braking in between form one segment (esses)."""


@dataclass(frozen=True)
class CornerStats:
    time: float
    """Seconds spent in the segment."""
    brake_at: float | None
    """Distance (m) where braking first starts before the slowest point; None without braking."""
    min_speed: float
    min_speed_at: float
    throttle_at: float | None
    """Distance (m) where throttle is back above THROTTLE_FULL after the slowest point."""
    top_speed: float
    """Highest speed after the slowest point: the straight that follows the corner."""


@dataclass(frozen=True)
class CornerSegment:
    label: str
    start: float
    end: float
    laps: list[CornerStats]


def _corner_groups(
    reference: Resampled, grid: np.ndarray, corners: list[tuple[str, float]]
) -> list[list[tuple[str, float]]]:
    """Merge chicanes, and corners the reference lap takes without braking in between."""
    brake = reference.channels["brake"]
    groups: list[list[tuple[str, float]]] = []
    for label, apex in sorted(corners, key=lambda c: c[1]):
        if groups:
            prev = groups[-1][-1][1]
            between = (grid > prev) & (grid < apex)
            onsets = np.diff(brake[between].astype(int)) > 0
            no_braking = not onsets.any() and not brake[between][:1].any()
            if apex - prev < CHICANE_GAP or (apex - prev < MERGE_GAP and no_braking):
                groups[-1].append((label, apex))
                continue
        groups.append([(label, apex)])
    return groups


def segment_stats(lap: Resampled, grid: np.ndarray, start: float, end: float) -> CornerStats:
    inside = np.flatnonzero((grid >= start) & (grid <= end))
    speed = lap.channels["speed"][inside]
    slowest = int(np.argmin(speed))

    # In a chicane the first braking phase is the one that matters, not the dab for part two.
    braking = np.flatnonzero(lap.channels["brake"][inside[: slowest + 1]] > 0)
    brake_at = float(grid[inside[braking[0]]]) if braking.size else None

    throttle = lap.channels["throttle"][inside[slowest:]]
    full = np.flatnonzero(throttle >= THROTTLE_FULL)
    throttle_at = float(grid[inside[slowest + full[0]]]) if full.size else None

    times = np.interp([start, end], grid, lap.time)
    return CornerStats(
        time=float(times[1] - times[0]),
        brake_at=brake_at,
        min_speed=float(speed[slowest]),
        min_speed_at=float(grid[inside[slowest]]),
        throttle_at=throttle_at,
        top_speed=float(speed[slowest:].max()),
    )


def corner_segments(
    comparison: Comparison, corners: list[tuple[str, float]]
) -> list[CornerSegment]:
    """
    Split the lap into one segment per corner (label, distance): braking zone, corner and the
    straight after it. Boundaries sit at the reference lap's top speed between two corners, so
    time lost on a straight counts for the corner before it, where the exit decided it.
    """
    grid = comparison.distance
    reference = comparison.laps[0]
    length = float(grid[-1])
    corners = [(label, d) for label, d in corners if 0 < d < length]
    if not corners:
        return []
    groups = _corner_groups(reference, grid, corners)

    speed = reference.channels["speed"]
    bounds = [0.0]
    for left, right in zip(groups, groups[1:], strict=False):
        between = np.flatnonzero((grid > left[-1][1]) & (grid < right[0][1]))
        if between.size == 0:
            bounds.append((left[-1][1] + right[0][1]) / 2)
        else:
            bounds.append(float(grid[between[np.argmax(speed[between])]]))
    bounds.append(length)

    segments = []
    for group, start, end in zip(groups, bounds[:-1], bounds[1:], strict=True):
        first, last = group[0][0], group[-1][0]
        label = f"T{first}" if first == last else f"T{first}–{last}"
        laps = [segment_stats(lap, grid, start, end) for lap in comparison.laps]
        segments.append(CornerSegment(label=label, start=start, end=end, laps=laps))
    return segments


POSITION_UNITS_PER_METRE = 10.0
"""x/y in the archive are in decimetres."""


def outline_distance(
    x: np.ndarray, y: np.ndarray, anchors: list[tuple[float, float, float]]
) -> tuple[np.ndarray, float]:
    """Lap distance (m) of every point of a circuit outline, and the lap length.

    The outline is drawn separately from any lap, so it neither starts at the line nor has the
    lap's scale. `anchors` are corners as (lap distance, x, y): each is matched to its nearest
    outline point, and distances in between are interpolated along the outline. Without usable
    anchors the outline is taken as decimetres from its first point.
    """
    steps = np.hypot(np.diff(x, append=x[:1]), np.diff(y, append=y[:1]))
    along = np.concatenate([[0.0], np.cumsum(steps[:-1])])
    total = float(steps.sum())

    matched = sorted(
        (d, float(along[np.argmin(np.hypot(x - ax, y - ay))])) for d, ax, ay in anchors
    )
    if len(matched) >= 2 and total > 0:
        da = np.array([d for d, _ in matched])
        sa = np.array([s for _, s in matched])
        # The outline may start anywhere on the lap: unwrap so position grows with distance.
        for i in range(1, len(sa)):
            while sa[i] < sa[i - 1]:
                sa[i] += total
        span = sa[-1] - sa[0]
        if 0 < span < total and da[-1] > da[0]:
            lap_length = total * (da[-1] - da[0]) / span
            # Close the loop: the first corner again, one lap later.
            sa = np.append(sa, sa[0] + total)
            da = np.append(da, da[0] + lap_length)
            shifted = sa[0] + np.mod(along - sa[0], total)
            return np.mod(np.interp(shifted, sa, da), lap_length), lap_length

    lap_length = total / POSITION_UNITS_PER_METRE
    return along / POSITION_UNITS_PER_METRE, lap_length
