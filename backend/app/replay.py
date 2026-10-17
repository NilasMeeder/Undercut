"""Replay: the session as it was at any moment t (session time, seconds).

- build_track: every car's position and lap progress on a fixed time grid over the whole session,
  from the telemetry of every lap. Built once per session and stored (see replays.py).
- TimingIndex / timing_state: the timing tower at t from the lap data alone (sector and line
  crossings), the way the official tower works. Needs no telemetry, so it is there instantly.
- track_status_periods: SC, VSC, red flag … over time, from race control; sector_flag_periods the
  yellow flags per marshal sector.
"""

import math
from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Literal

import numpy as np

from app.schemas import (
    CarStatus,
    Lap,
    RaceControlMessage,
    SectorFlag,
    Segment,
    StatusPeriod,
    TimingClass,
    TimingState,
    TowerRow,
    TowerSector,
    TrackStatus,
)

SessionKind = Literal["race", "quali", "practice"]

TRACK_STEP = 0.25
"""Seconds between samples of the position track (4 Hz, about the telemetry's own rate)."""
MAX_SAMPLE_GAP = 2.0
"""Samples further apart than this have no data in between: the car is not on track."""
GARAGE_SECONDS = 60.0
"""A pit stop longer than this went into the garage: the car is hidden until it comes out."""


def session_kind(code: str) -> SessionKind:
    if code in ("R", "S"):
        return "race"
    if code in ("Q", "SQ", "SS"):
        return "quali"
    return "practice"


# --- Position track ------------------------------------------------------------------------------


@dataclass
class LapSamples:
    """One lap of telemetry, as needed for the position track."""

    driver: str
    lap: int
    start: float
    """Session time of the lap start; sample times are relative to it."""
    time: np.ndarray
    distance: np.ndarray
    x: np.ndarray
    y: np.ndarray
    from_line: bool
    """False when the lap does not start at the line: race lap 1 (from the grid) and out-laps (from
    the pit box). Their distance is counted back from the line at the end instead."""


@dataclass
class Track:
    start: float
    step: float
    lap_length: float
    drivers: list[str]
    x: np.ndarray
    y: np.ndarray
    progress: np.ndarray
    """Shape (drivers, samples), NaN where the car is not on track. Progress in laps driven."""


def lap_length(laps: list[LapSamples]) -> float:
    full = [lap.distance[-1] for lap in laps if lap.from_line and len(lap.distance)]
    return float(np.median(full or [lap.distance[-1] for lap in laps if len(lap.distance)]))


def lap_fraction(lap: LapSamples, length: float) -> np.ndarray:
    """Position along the lap, 0 at the line to just under 1 at the next line."""
    d = lap.distance
    fraction = d / d[-1] if lap.from_line and d[-1] > 0 else 1 - (d[-1] - d) / length
    return np.clip(fraction, 0.0, 0.9999)


def _resample(grid: np.ndarray, t: np.ndarray, values: np.ndarray) -> np.ndarray:
    """Linear interpolation onto the grid, NaN outside the data and across gaps."""
    if len(t) < 2:
        return np.full(len(grid), np.nan)
    j = np.searchsorted(t, grid, side="right") - 1
    inside = (j >= 0) & (j < len(t) - 1)
    j = np.clip(j, 0, len(t) - 2)
    t0, t1 = t[j], t[j + 1]
    span = t1 - t0
    f = np.divide(grid - t0, span, out=np.zeros_like(grid), where=span > 0)
    out = values[j] + f * (values[j + 1] - values[j])
    out[~inside | (span > MAX_SAMPLE_GAP)] = np.nan
    return out


def garage_windows(laps: list[Lap]) -> dict[str, list[tuple[float, float]]]:
    """Per driver: (pit entry, pit exit) of every stop long enough to be a garage visit."""
    by_driver: dict[str, list[Lap]] = defaultdict(list)
    for lap in laps:
        by_driver[lap.driver].append(lap)
    windows: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for driver, own in by_driver.items():
        own.sort(key=lambda lap: lap.lap)
        for before, after in zip(own, own[1:], strict=False):
            entry, exit_ = before.pit_in_time, after.pit_out_time
            if entry is not None and exit_ is not None and exit_ - entry > GARAGE_SECONDS:
                windows[driver].append((entry, exit_))
    return windows


def build_track(
    laps: list[LapSamples],
    garages: dict[str, list[tuple[float, float]]],
    step: float = TRACK_STEP,
) -> Track:
    laps = [lap for lap in laps if len(lap.time) >= 2]
    if not laps:
        raise ValueError("No telemetry to build a position track from")
    start = math.floor(min(lap.start for lap in laps))
    end = math.ceil(max(lap.start + lap.time[-1] for lap in laps))
    grid = start + step * np.arange(int((end - start) / step) + 1)
    length = lap_length(laps)

    drivers = sorted({lap.driver for lap in laps})
    shape = (len(drivers), len(grid))
    x, y, progress = np.full(shape, np.nan), np.full(shape, np.nan), np.full(shape, np.nan)
    for row, driver in enumerate(drivers):
        own = sorted((lap for lap in laps if lap.driver == driver), key=lambda lap: lap.lap)
        t = np.concatenate([lap.start + lap.time for lap in own])
        order = np.argsort(t, kind="stable")
        t = t[order]
        columns = {
            "x": np.concatenate([lap.x for lap in own])[order],
            "y": np.concatenate([lap.y for lap in own])[order],
            "progress": np.concatenate([lap.lap - 1 + lap_fraction(lap, length) for lap in own])[
                order
            ],
        }
        hidden = np.zeros(len(grid), dtype=bool)
        for entry, exit_ in garages.get(driver, []):
            hidden |= (grid >= entry) & (grid <= exit_)
        for name, target in (("x", x), ("y", y), ("progress", progress)):
            values = _resample(grid, t, columns[name])
            values[hidden] = np.nan
            target[row] = values
    return Track(float(start), step, length, drivers, x, y, progress)


# --- Track status --------------------------------------------------------------------------------


def _status_change(message: RaceControlMessage) -> TrackStatus | None:
    text = message.message.upper()
    if message.category == "SafetyCar":
        if "VIRTUAL SAFETY CAR DEPLOYED" in text:
            return "vsc"
        if "VIRTUAL SAFETY CAR ENDING" in text:
            return "vsc_ending"
        if "SAFETY CAR DEPLOYED" in text:
            return "sc"
        return None
    if message.category == "Flag" and message.scope == "Track":
        return {
            "GREEN": "green",
            "CLEAR": "green",
            "RED": "red",
            "CHEQUERED": "chequered",
            "YELLOW": "yellow",
            "DOUBLE YELLOW": "yellow",
        }.get(message.flag or "")
    return None


def track_status_periods(
    messages: list[RaceControlMessage], start: float, end: float
) -> list[StatusPeriod]:
    """Track-wide status from start to end, as consecutive periods."""
    changes = sorted(
        (m.session_time, status, m.flag)
        for m in messages
        if m.session_time is not None and (status := _status_change(m)) is not None
    )
    status: TrackStatus = "green"
    since = start
    periods: list[StatusPeriod] = []
    for at, new, flag in changes:
        # During a red flag (or after the chequered flag) "TRACK CLEAR" only means the marshals
        # are done; the session resumes with the green light.
        if status in ("red", "chequered") and flag == "CLEAR":
            continue
        if at <= start:
            status = new
            continue
        if at >= end:
            break
        if new != status:
            periods.append(StatusPeriod(start=since, end=at, status=status))
            status, since = new, at
    periods.append(StatusPeriod(start=since, end=end, status=status))
    return periods


_SECTOR_FLAGS = {"YELLOW": "yellow", "DOUBLE YELLOW": "double_yellow"}
_TRACK_RESETS = {"GREEN", "CLEAR", "RED", "CHEQUERED"}
"""Track-wide flags that end every sector flag."""


def sector_flag_periods(
    messages: list[RaceControlMessage], start: float, end: float
) -> list[SectorFlag]:
    """Yellow and double yellow flags per marshal sector, until cleared (or end)."""
    timed = sorted(
        (m for m in messages if m.session_time is not None and m.category == "Flag"),
        key=lambda m: m.session_time or 0.0,
    )
    active: dict[int, tuple[str, float]] = {}
    periods: list[SectorFlag] = []

    def close(sector: int, at: float) -> None:
        flag, since = active.pop(sector)
        if min(at, end) > max(since, start):
            periods.append(
                SectorFlag(sector=sector, start=max(since, start), end=min(at, end), flag=flag)
            )

    for m in timed:
        at = m.session_time or 0.0
        if m.scope == "Sector" and m.sector is not None:
            flag = _SECTOR_FLAGS.get(m.flag or "")
            if m.sector in active and active[m.sector][0] != flag:
                close(m.sector, at)
            if flag and m.sector not in active:
                active[m.sector] = (flag, at)
        elif m.scope == "Track" and m.flag in _TRACK_RESETS:
            for sector in list(active):
                close(sector, at)
    for sector in list(active):
        close(sector, end)
    return sorted(periods, key=lambda p: (p.start, p.sector))


def status_at(periods: list[StatusPeriod], t: float) -> TrackStatus:
    for period in periods:
        if period.start <= t < period.end:
            return period.status
    return periods[-1].status if periods and t >= periods[-1].end else "green"


# --- Timing tower --------------------------------------------------------------------------------

_FIELDS = ("lap_time", "sector_1", "sector_2", "sector_3")


def _done_at(lap: Lap, name: str) -> float | None:
    """When a lap's time or sector time became known."""
    return {
        "lap_time": lap.end_time,
        "sector_1": lap.sector_1_end,
        "sector_2": lap.sector_2_end,
        "sector_3": lap.end_time,
    }[name]


@dataclass
class TimingIndex:
    """Everything timing_state needs, precomputed once per session."""

    kind: SessionKind
    laps: dict[str, list[Lap]]
    """Per driver, in lap order."""
    status: list[StatusPeriod]
    segments: list[Segment]
    events: list[float]
    """Every moment at which the tower can change, sorted."""
    timing: dict[tuple[str, int, str], TimingClass]
    """(driver, lap, field) -> class at the moment the time was set."""
    completions: list[tuple[float, str, str, float, int]]
    """(done at, driver, field, value, lap) for every time set, sorted; deleted laps excluded."""
    total_laps: int | None = None
    finish_time: float | None = None
    """Race: when the winner took the chequered flag."""
    points: dict[str, tuple[list[float], list[int]]] = field(default_factory=dict)
    """Race, per driver: times and numbers of the timing points passed (3 per lap: S1, S2, line)."""
    point_time: dict[str, dict[int, float]] = field(default_factory=dict)


def segments(laps: list[Lap]) -> list[Segment]:
    spans: dict[str, list[float]] = {}
    for lap in laps:
        if lap.quali_segment is None or lap.start_time is None:
            continue
        span = spans.setdefault(lap.quali_segment, [math.inf, -math.inf])
        # An out-lap starts when the previous run ended, garage time included; the segment starts
        # when the car leaves the pit.
        span[0] = min(span[0], lap.pit_out_time or lap.start_time)
        span[1] = max(span[1], lap.end_time or lap.start_time)
    return sorted(
        (Segment(name=name, start=a, end=b) for name, (a, b) in spans.items()),
        key=lambda s: s.start,
    )


def build_index(laps: list[Lap], kind: SessionKind, status: list[StatusPeriod]) -> TimingIndex:
    by_driver: dict[str, list[Lap]] = defaultdict(list)
    for lap in laps:
        by_driver[lap.driver].append(lap)
    for own in by_driver.values():
        own.sort(key=lambda lap: lap.lap)

    completions = sorted(
        (done, lap.driver, name, value, lap.lap)
        for lap in laps
        if not lap.deleted
        for name in _FIELDS
        if (value := getattr(lap, name)) is not None and (done := _done_at(lap, name)) is not None
    )
    timing: dict[tuple[str, int, str], TimingClass] = {}
    overall: dict[str, float] = {}
    personal: dict[tuple[str, str], float] = {}
    for _, driver, name, value, number in completions:
        if value < overall.get(name, math.inf):
            cls: TimingClass = "best"
        elif value < personal.get((driver, name), math.inf):
            cls = "pb"
        else:
            cls = "none"
        overall[name] = min(value, overall.get(name, math.inf))
        personal[(driver, name)] = min(value, personal.get((driver, name), math.inf))
        timing[(driver, number, name)] = cls

    events = sorted(
        {
            t
            for lap in laps
            for t in (
                lap.start_time,
                lap.end_time,
                lap.sector_1_end,
                lap.sector_2_end,
                lap.pit_in_time,
                lap.pit_out_time,
            )
            if t is not None
        }
        | {p.start for p in status}
    )
    index = TimingIndex(
        kind=kind,
        laps=dict(by_driver),
        status=status,
        segments=segments(laps) if kind == "quali" else [],
        events=events,
        timing=timing,
        completions=completions,
    )
    if kind == "race":
        _index_race(index)
    return index


def driven(lap: Lap) -> bool:
    """False for placeholder laps without any timing (a car that did not start has one)."""
    return any(
        v is not None
        for v in (lap.lap_time, lap.sector_1, lap.sector_2, lap.sector_3, lap.sector_2_end)
    )


def _index_race(index: TimingIndex) -> None:
    for driver, own in index.laps.items():
        crossings = sorted(
            (t, (lap.lap - 1) * 3 + k)
            for lap in own
            if driven(lap)
            for k, t in ((1, lap.sector_1_end), (2, lap.sector_2_end), (3, lap.end_time))
            if t is not None
        )
        # A point passed twice (bad data) keeps its first time; points must only go up.
        times, numbers, best = [], [], 0
        for t, number in crossings:
            if number > best:
                times.append(t)
                numbers.append(number)
                best = number
        index.points[driver] = (times, numbers)
        index.point_time[driver] = dict(zip(numbers, times, strict=True))
    index.total_laps = max((lap.lap for own in index.laps.values() for lap in own), default=None)
    winners = [
        lap.end_time
        for own in index.laps.values()
        for lap in own
        if lap.lap == index.total_laps and lap.end_time is not None
    ]
    index.finish_time = min(winners, default=None)


def _bests_at(index: TimingIndex, t: float) -> dict[str, float]:
    """Session best per field as it stood at t."""
    overall: dict[str, float] = {}
    for done, _, name, value, _ in index.completions:
        if done > t:
            break
        overall[name] = min(value, overall.get(name, math.inf))
    return overall


def _current_lap(own: list[Lap], t: float) -> Lap | None:
    for lap in own:
        if lap.start_time is not None and lap.start_time <= t < (lap.end_time or math.inf):
            return lap
    return None


def _completed(own: list[Lap], t: float) -> list[Lap]:
    return [lap for lap in own if lap.end_time is not None and lap.end_time <= t]


def _pit_window(own: list[Lap], t: float) -> tuple[float, float] | None:
    """The pit stop the car is in at t: (entry, exit), exit infinite if it never came out."""
    for i, lap in enumerate(own):
        entry = lap.pit_in_time
        if entry is None or entry > t:
            continue
        nxt = own[i + 1] if i + 1 < len(own) else None
        exit_ = nxt.pit_out_time if nxt and nxt.pit_out_time is not None else math.inf
        if t < exit_:
            return entry, exit_
    return None


def _sectors(index: TimingIndex, own: list[Lap], t: float) -> list[TowerSector]:
    """The lap in progress' sectors as far as they are done, else those of the lap before."""
    current = _current_lap(own, t)
    done = _completed(own, t)
    previous = done[-1] if done else None
    sectors = []
    for name in ("sector_1", "sector_2", "sector_3"):
        if current is not None and (at := _done_at(current, name)) is not None and at <= t:
            source, is_current = current, True
        else:
            source, is_current = previous, current is None
        value = getattr(source, name) if source else None
        timing = index.timing.get((source.driver, source.lap, name), "none") if source else "none"
        sectors.append(TowerSector(time=value, timing=timing, current=is_current and bool(source)))
    return sectors


def _base_row(index: TimingIndex, driver: str, t: float, overall: dict[str, float]) -> TowerRow:
    own = index.laps[driver]
    done = _completed(own, t)
    counted = [lap for lap in done if lap.lap_time is not None and not lap.deleted]
    best = min(counted, key=lambda lap: lap.lap_time or math.inf, default=None)
    timed = [lap for lap in done if lap.lap_time is not None]
    last = timed[-1] if timed else None
    tyre = _current_lap(own, t) or (done[-1] if done else None) or (own[0] if own else None)
    return TowerRow(
        position=0,
        driver=driver,
        status="running",
        laps=len(done),
        gap=None,
        interval=None,
        laps_down=0,
        interval_laps=0,
        best_lap=best.lap_time if best else None,
        best_timing="best" if best and best.lap_time == overall.get("lap_time") else "none",
        last_lap=last.lap_time if last else None,
        last_timing=index.timing.get((driver, last.lap, "lap_time"), "none") if last else "none",
        sectors=_sectors(index, own, t),
        compound=tyre.compound if tyre else None,
        tyre_age=tyre.tyre_life if tyre else None,
        pit_stops=sum(1 for lap in own if lap.lap > 1 and (lap.pit_out_time or math.inf) <= t),
        eliminated=False,
    )


def _latest_point(index: TimingIndex, driver: str, t: float) -> tuple[int, float]:
    times, numbers = index.points.get(driver, ([], []))
    i = bisect_right(times, t) - 1
    return (numbers[i], times[i]) if i >= 0 else (0, math.inf)


def _behind(index: TimingIndex, ahead: str, point: int, at: float) -> tuple[float | None, int]:
    """Gap of a car that passed `point` at `at` to the car `ahead`: seconds, or whole laps."""
    passed = index.point_time.get(ahead, {})
    laps = 0
    while passed.get(point + 3 * (laps + 1), math.inf) <= at:
        laps += 1
    if laps:
        return None, laps
    there = passed.get(point)
    return (round(at - there, 3) if there is not None else None), 0


def _race_rows(index: TimingIndex, t: float, overall: dict[str, float]) -> list[TowerRow]:
    rows = []
    for driver, own in index.laps.items():
        row = _base_row(index, driver, t, overall)
        ends = [lap.end_time for lap in own if driven(lap) and lap.end_time is not None]
        # No timed lap at all: did not start.
        final_end = max(ends, default=-math.inf)
        finished = index.finish_time is not None and final_end >= index.finish_time
        status: CarStatus = "running"
        if t >= final_end:
            status = "finished" if finished else "retired"
        elif _pit_window(own, t):
            status = "pit"
        row.status = status
        rows.append(row)

    # Before the first timing point everyone is still in grid order; the archive has no grid, so
    # use the order in which they passed the first point.
    first = {d: index.points[d][0][0] if index.points[d][0] else math.inf for d in index.laps}

    def key(row: TowerRow) -> tuple[bool, int, float]:
        point, at = _latest_point(index, row.driver, t)
        return (row.status == "retired", -point, at if point else first[row.driver])

    rows.sort(key=key)
    leader = rows[0].driver if rows else None
    for i, row in enumerate(rows):
        row.position = i + 1
        point, at = _latest_point(index, row.driver, t)
        if i == 0 or point == 0 or leader is None or row.status == "retired":
            continue
        row.gap, row.laps_down = _behind(index, leader, point, at)
        row.interval, row.interval_laps = _behind(index, rows[i - 1].driver, point, at)
        # A car that lost places in the pit lane is behind on points but was still ahead at its
        # last timing line: that gap is stale (negative) until it reaches the next line.
        if row.gap is not None and row.gap < 0:
            row.gap = None
        if row.interval is not None and row.interval < 0:
            row.interval = None
    return rows


def _quali_status(own: list[Lap], t: float) -> CarStatus:
    window = _pit_window(own, t)
    if window:
        return "garage" if window[1] - window[0] > GARAGE_SECONDS else "pit"
    lap = _current_lap(own, t)
    if lap is None:
        return "garage"
    if lap.pit_out:
        return "out_lap"
    if lap.pit_in:
        return "in_lap"
    return "running"


def _best_in(own: list[Lap], segment: str | None, t: float) -> float | None:
    times = [
        lap.lap_time
        for lap in own
        if lap.lap_time is not None
        and not lap.deleted
        and lap.end_time is not None
        and lap.end_time <= t
        and (segment is None or lap.quali_segment == segment)
    ]
    return min(times, default=None)


def _quali_rows(index: TimingIndex, t: float, overall: dict[str, float]) -> list[TowerRow]:
    names = [s.name for s in index.segments] or [None]
    current = max((i for i, s in enumerate(index.segments) if s.start <= t), default=0)

    def drivers_in(i: int) -> list[str]:
        if names[i] is None:
            return list(index.laps)
        return [d for d, own in index.laps.items() if any(x.quali_segment == names[i] for x in own)]

    rows: list[TowerRow] = []

    def add(drivers: list[str], segment: str | None, until: float, eliminated: bool) -> None:
        previous = names[names.index(segment) - 1] if segment and names.index(segment) > 0 else None
        ranked = sorted(
            drivers,
            key=lambda d: (
                _best_in(index.laps[d], segment, until) or math.inf,
                _best_in(index.laps[d], previous, until) or math.inf if previous else math.inf,
                d,
            ),
        )
        for driver in ranked:
            row = _base_row(index, driver, t, overall)
            row.best_lap = _best_in(index.laps[driver], segment, until)
            fastest = row.best_lap is not None and row.best_lap == overall.get("lap_time")
            row.best_timing = "best" if fastest else "none"
            row.status = _quali_status(index.laps[driver], t)
            row.eliminated = eliminated
            rows.append(row)

    through = drivers_in(current)
    add(through, names[current], t, eliminated=False)
    placed = set(through)
    for i in range(current - 1, -1, -1):
        out = [d for d in drivers_in(i) if d not in placed]
        add(out, names[i], index.segments[i].end, eliminated=True)
        placed.update(out)
    add([d for d in index.laps if d not in placed], None, t, eliminated=True)

    leader_best = rows[0].best_lap if rows else None
    for i, row in enumerate(rows):
        row.position = i + 1
        if i == 0 or row.best_lap is None or row.eliminated:
            continue
        if leader_best is not None:
            row.gap = round(row.best_lap - leader_best, 3)
        ahead = rows[i - 1].best_lap
        if ahead is not None:
            row.interval = round(row.best_lap - ahead, 3)
    return rows


def timing_state(index: TimingIndex, t: float) -> TimingState:
    overall = _bests_at(index, t)
    i = bisect_right(index.events, t)
    rows = _race_rows(index, t, overall) if index.kind == "race" else _quali_rows(index, t, overall)

    lap = None
    if index.kind == "race" and rows and index.total_laps:
        lap = min(rows[0].laps + 1, index.total_laps)
    segment = cutoff = None
    if index.segments:
        current = max((k for k, s in enumerate(index.segments) if s.start <= t), default=0)
        segment = index.segments[current].name
        if current + 1 < len(index.segments):
            following = index.segments[current + 1].name
            cutoff = sum(
                1 for own in index.laps.values() if any(x.quali_segment == following for x in own)
            )
    return TimingState(
        time=t,
        valid_from=index.events[i - 1] if i > 0 else None,
        valid_until=index.events[i] if i < len(index.events) else None,
        kind=index.kind,
        lap=lap,
        total_laps=index.total_laps,
        segment=segment,
        cutoff=cutoff,
        track_status=status_at(index.status, t),
        rows=rows,
    )
