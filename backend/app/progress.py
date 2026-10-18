"""The lap a driver is on at session time t, as far as it got, against a finished lap: the live
delta. Replay cuts a finished lap off at t; live, the lap is not finished, so its samples come
from the recorder's memory (live/service.py)."""

from dataclasses import dataclass
from typing import Literal

import numpy as np

from app import analysis, sessions
from app.live import service as live
from app.schemas import Lap
from app.sources.tracinginsights import SourceNotAvailable

Reference = Literal["previous", "best"]

STEP = 5.0
"""Grid spacing (m) of the delta."""
HOLD = 3.0
"""Live, the seconds after the line in which the lap that just finished is shown (the new one
has no samples yet)."""
MAX_STRETCH = 0.005
"""Laps whose lengths differ more than this (a pit lap) are not stretched to each other."""


@dataclass(frozen=True)
class Progress:
    lap: int
    start: float
    """Session time (s) the lap started."""
    out_lap: bool
    """The lap after a pit stop (or the first out of the garage): the delta means little."""
    trace: analysis.LapTrace
    """From the start of the lap to t."""
    length: float | None
    """The whole lap's length when it is finished (replay), to stretch it like analysis.compare."""
    reference: Lap | None
    reference_trace: analysis.LapTrace | None


def clip(trace: analysis.LapTrace, until: float) -> analysis.LapTrace | None:
    """The trace up to `until` seconds into the lap, ending on an interpolated sample."""
    if until <= trace.time[0]:
        return None
    if until >= trace.time[-1]:
        return trace
    keep = int(np.searchsorted(trace.time, until, side="right"))

    def cut(values: np.ndarray, held: bool) -> np.ndarray:
        end = values[keep - 1] if held else np.interp(until, trace.time, values)
        return np.append(values[:keep], end)

    return analysis.LapTrace(
        distance=cut(trace.distance, False),
        time=np.append(trace.time[:keep], until),
        channels={
            name: cut(values, name in ("gear", "brake", "drs"))
            for name, values in trace.channels.items()
        },
    )


@dataclass(frozen=True)
class OnGrid:
    distance: np.ndarray
    """Every `step` m over the reference lap (or the lap so far, without one)."""
    progress: float
    """Metres of the lap so far, on the grid's scale."""
    current: dict[str, np.ndarray]
    """time and the channels of the lap so far; NaN past `progress`."""
    reference: dict[str, np.ndarray] | None
    delta: np.ndarray
    """Seconds behind the reference (positive = slower); NaN past either lap's end."""


def on_grid(
    current: analysis.LapTrace,
    reference: analysis.LapTrace | None,
    length: float | None = None,
    step: float = STEP,
) -> OnGrid:
    """The lap so far and the reference on one distance grid, and the delta between them. With
    the whole lap's `length` the lap is stretched to the reference's length as in
    analysis.compare, so the delta at the line is the lap time difference; live that length is
    not known yet and the delta drifts a little (the integrated distances of two laps differ by a
    few metres). A pit lap (another route) is never stretched."""
    scale = reference.length / length if reference is not None and length else 1.0
    if abs(scale - 1) > MAX_STRETCH:
        scale = 1.0
    scaled = analysis.LapTrace(current.distance * scale, current.time, current.channels)
    full = max(reference.length if reference is not None else 0.0, scaled.length)
    grid = analysis.make_grid(full, step)
    inside = grid <= scaled.length

    def pad(values: np.ndarray, where: np.ndarray) -> np.ndarray:
        out = np.full(len(grid), np.nan)
        out[where] = values
        return out

    part = analysis.resample(scaled, grid[inside], scaled.length)
    lap = {"time": pad(part.time, inside)} | {
        name: pad(values, inside) for name, values in part.channels.items()
    }
    ref = None
    behind = np.full(len(grid), np.nan)
    if reference is not None:
        covered = grid <= reference.length
        whole = analysis.resample(reference, grid[covered], reference.length)
        ref = {"time": pad(whole.time, covered), "speed": pad(whole.channels["speed"], covered)}
        behind = lap["time"] - ref["time"]
    return OnGrid(grid, scaled.length, lap, ref, behind)


def _row_trace(year: int, round_number: int, code: str, row: Lap) -> analysis.LapTrace | None:
    """A finished lap's trace: the archive's file, or live from memory before it is written."""
    try:
        return sessions.get_trace(year, round_number, code, row.driver, row.lap)
    except SourceNotAvailable:
        pass
    recording = live.service.get((year, round_number, code))
    if recording is None or recording.finished or row.start_time is None or row.end_time is None:
        return None
    tel = recording.lap_samples(row.driver, row.start_time, row.end_time)
    return sessions.trace_from_tel(tel, year) if tel else None


def _reference(laps: list[Lap], lap: int, t: float, kind: Reference) -> Lap | None:
    if kind == "previous":
        return next((row for row in laps if row.lap == lap - 1), None)
    done = [
        row
        for row in laps
        if row.lap_time is not None
        and not row.deleted
        and row.end_time is not None
        and row.end_time <= t
    ]
    return min(done, key=lambda row: row.lap_time or 0) if done else None


def lap_in_progress(
    year: int, round_number: int, code: str, driver: str, t: float, kind: Reference = "previous"
) -> Progress:
    laps = sorted(
        (row for row in sessions.get_laps(year, round_number, code) if row.driver == driver),
        key=lambda row: row.lap,
    )
    if not laps:
        raise LookupError(f"{driver} has no laps in this session")
    on = next(
        (
            row
            for row in laps
            if row.start_time is not None
            and row.end_time is not None
            and row.start_time <= t < row.end_time
        ),
        None,
    )
    if on is not None and on.start_time is not None:
        full = _row_trace(year, round_number, code, on)
        trace = clip(full, t - on.start_time) if full is not None else None
        length = full.length if full is not None else None
        number, start, out_lap = on.lap, on.start_time, on.pit_out
    else:
        # Live: the lap after the last finished one, from the recorder's memory.
        recording = live.service.get((year, round_number, code))
        done = [row for row in laps if row.end_time is not None and row.end_time <= t]
        if recording is None or recording.finished or not done:
            raise LookupError(f"{driver} is not on a lap at this time")
        last = done[-1]
        assert last.end_time is not None and last.start_time is not None
        tel = recording.lap_samples(driver, last.end_time, t)
        trace = sessions.trace_from_tel(tel, year) if tel else None
        length = None
        number, start, out_lap = last.lap + 1, last.end_time, last.pit_in
        if trace is None and t - last.end_time < HOLD:
            # Just over the line, no samples of the new lap yet: the lap that just finished.
            trace = _row_trace(year, round_number, code, last)
            length = trace.length if trace is not None else None
            number, start, out_lap = last.lap, last.start_time, last.pit_out
    if trace is None or len(trace.time) < 2:
        raise LookupError(f"No telemetry yet for {driver} lap {number}")
    reference = _reference(laps, number, t, kind)
    reference_trace = (
        _row_trace(year, round_number, code, reference) if reference is not None else None
    )
    return Progress(
        lap=number,
        start=start,
        out_lap=out_lap,
        trace=trace,
        length=length,
        reference=reference if reference_trace is not None else None,
        reference_trace=reference_trace,
    )


PREDICT_FROM = 300.0
"""Metres into a lap before a prediction says anything: the first corner decides little."""
PREDICT_SLACK = 1.0
"""Seconds behind the best lap at which a lap is not a push lap (a cool-down, a slow lap, a
big mistake): no prediction."""


@dataclass(frozen=True)
class Prediction:
    driver: str
    lap: int
    distance: float
    """Metres into the lap, on the reference lap's scale."""
    fraction: float
    """Share of the lap done (0–1)."""
    delta: float
    """Seconds behind the reference lap at that point (positive = slower)."""
    reference_lap: int
    reference_time: float
    predicted: float
    """The reference lap time plus the delta so far: what the lap is on course for."""


def predict(year: int, round_number: int, code: str, driver: str, t: float) -> Prediction | None:
    """What the lap `driver` is on at t is on course for: his best lap until t plus the delta
    so far. None on an out-lap, without a best lap, early in the lap, or when it is no push lap."""
    try:
        p = lap_in_progress(year, round_number, code, driver, t, "best")
    except (LookupError, SourceNotAvailable):
        return None
    ref, ref_trace = p.reference, p.reference_trace
    if p.out_lap or ref is None or ref_trace is None or ref.lap_time is None or ref.lap == p.lap:
        return None
    scale = ref_trace.length / p.length if p.length else 1.0
    if abs(scale - 1) > MAX_STRETCH:
        scale = 1.0
    distance = float(p.trace.distance[-1] * scale)
    if distance < PREDICT_FROM or distance >= ref_trace.length:
        return None
    delta = float(p.trace.time[-1] - np.interp(distance, ref_trace.distance, ref_trace.time))
    if delta > PREDICT_SLACK:
        return None
    return Prediction(
        driver=driver,
        lap=p.lap,
        distance=distance,
        fraction=distance / ref_trace.length,
        delta=delta,
        reference_lap=ref.lap,
        reference_time=ref.lap_time,
        predicted=ref.lap_time + delta,
    )
