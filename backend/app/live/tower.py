"""The timing tower as F1 sends it (TimingData), laid over the one worked out from the laps.

While a session is live the laps come from a conversion every few seconds, so the tower from the
laps runs up to ~4 s behind, and a recording that started late has no laps (no order, no gaps)
for a car until it crosses a timing line. TimingData has F1's own order, gaps and intervals the
moment they change, and its state at subscription has them for every car. Sectors, tyres and
purple/green stay from the laps, where they mean what they mean in the archive.

F1's mini-sectors (Segments, the coloured bars of the official timing) exist only in the feed.
Each has a status: 2048 neither, 2049 personal best, 2051 overall best, 2064 pit lane, 0 not yet
driven. After a recording they are kept in converted/segments.json, so its replay has them too.
"""

import logging
import re
from bisect import bisect_right
from dataclasses import dataclass, field
from typing import Any

from app.schemas import CarStatus, SegmentClass, TimingState, TowerRow, TowerSector

log = logging.getLogger(__name__)

MIN_VALID = 0.25
"""Seconds a tower answer stays valid at least: the feed changes many times a second."""

_FLAGS = {"InPit": "in_pit", "Retired": "retired", "Stopped": "stopped", "KnockedOut": "out"}

_SEGMENT_STATUS: dict[int, SegmentClass] = {
    0: "none",
    2048: "slow",
    2049: "pb",
    2051: "best",
    2064: "pit",
}
_SEGMENT_CHAR: dict[SegmentClass, str] = {
    "none": "-",
    "slow": "y",
    "pb": "g",
    "best": "p",
    "pit": "i",
}
_CHAR_SEGMENT = {char: name for name, char in _SEGMENT_CHAR.items()}
_unknown_statuses: set[int] = set()


def segment_class(status: int) -> SegmentClass:
    """F1's segment status as a class. Unknown codes are read as flags (2048 = driven, +1 personal
    best, +2 overall best, +16 pit lane) and logged once: the recording keeps the raw codes."""
    if status in _SEGMENT_STATUS:
        return _SEGMENT_STATUS[status]
    if status not in _unknown_statuses:
        _unknown_statuses.add(status)
        log.info("Unknown segment status %s", status)
    if not status & 2048:
        return "none"
    if status & 16:
        return "pit"
    return "best" if status & 2 else "pb" if status & 1 else "slow"


def encode_segments(statuses: list[list[int]]) -> str:
    """Per sector one character per segment, sectors split by "|": "ygp|y-|--"."""
    return "|".join("".join(_SEGMENT_CHAR[segment_class(s)] for s in row) for row in statuses)


def decode_segments(text: str | None) -> list[list[SegmentClass]]:
    if not text:
        return []
    return [[_CHAR_SEGMENT.get(c, "none") for c in part] for part in text.split("|")]


def _items(value: Any) -> list[tuple[int, Any]]:
    """F1 sends arrays in its state as lists, in updates as dicts keyed "0", "1", ..."""
    pairs = value.items() if isinstance(value, dict) else enumerate(value or [])
    out = []
    for key, item in pairs:
        try:
            out.append((int(key), item))
        except (TypeError, ValueError):
            continue
    return out


@dataclass
class CarFeed:
    """One car's line in F1's tower at a moment."""

    position: int | None = None
    gap: str | None = None
    """Race: GapToLeader ("+1.234", "1L", "LAP 36"); practice: TimeDiffToFastest."""
    interval: str | None = None
    """Race: IntervalToPositionAhead; practice: TimeDiffToPositionAhead."""
    parts: dict[int, tuple[str | None, str | None]] = field(default_factory=dict)
    """Qualifying: per part (0 = Q1) the difference to the fastest and to the car ahead."""
    laps: int | None = None
    pit_stops: int | None = None
    in_pit: bool = False
    retired: bool = False
    stopped: bool = False
    out: bool = False
    """Qualifying: knocked out."""
    compound: str | None = None
    tyre_age: int | None = None
    segments: str | None = None
    """F1's mini-sectors of the lap in progress, see encode_segments."""


@dataclass
class _Log:
    times: list[float] = field(default_factory=list)
    values: list[Any] = field(default_factory=list)

    def add(self, at: float, value: Any) -> bool:
        if self.values and self.values[-1] == value:
            return False
        if self.times and at < self.times[-1]:
            at = self.times[-1]  # state resent after a reconnect: it holds from then
        # Values first: requests read while the live thread adds (bisect on times).
        self.values.append(value)
        self.times.append(at)
        return True

    def at(self, t: float) -> Any:
        i = bisect_right(self.times, t) - 1
        return self.values[i] if i >= 0 else None


class FeedTower:
    """Every change of each car's tower fields, to look up F1's tower at any time."""

    def __init__(self) -> None:
        self.cars: dict[str, dict[str, _Log]] = {}
        self.changes: list[float] = []
        self._segments: dict[str, list[list[int]]] = {}
        """Car number -> the raw segment statuses per sector now (updates send only changes)."""

    def _set(self, number: str, name: str, at: float, value: Any) -> None:
        changed = self.cars.setdefault(number, {}).setdefault(name, _Log()).add(at, value)
        if changed and (not self.changes or at > self.changes[-1]):
            self.changes.append(at)

    def add_timing(self, at: float, data: dict[str, Any]) -> None:
        """A TimingData message (the state at subscription: `at` before everything)."""
        for number, line in (data.get("Lines") or {}).items():
            if not isinstance(line, dict):
                continue
            position = line.get("Position") or line.get("Line")
            if isinstance(position, int) or (isinstance(position, str) and position.isdigit()):
                self._set(number, "position", at, int(position))
            for key, name in (("GapToLeader", "gap"), ("TimeDiffToFastest", "gap")):
                if isinstance(line.get(key), str):
                    self._set(number, name, at, line[key] or None)
            for key in ("IntervalToPositionAhead", "TimeDiffToPositionAhead"):
                value = line.get(key)
                if isinstance(value, dict):
                    value = value.get("Value")
                if isinstance(value, str):
                    self._set(number, "interval", at, value or None)
            stats = line.get("Stats")
            parts = stats.items() if isinstance(stats, dict) else enumerate(stats or [])
            for part, values in parts:
                if not isinstance(values, dict):
                    continue
                for key, end in (
                    ("TimeDiffToFastest", "fastest"),
                    ("TimeDifftoPositionAhead", "ahead"),
                ):
                    if isinstance(values.get(key), str):
                        self._set(number, f"q{int(part)}_{end}", at, values[key] or None)
            for key, name in _FLAGS.items():
                if isinstance(line.get(key), bool):
                    self._set(number, name, at, line[key])
            for key, name in (("NumberOfLaps", "laps"), ("NumberOfPitStops", "pit_stops")):
                if isinstance(line.get(key), int):
                    self._set(number, name, at, line[key])
            if line.get("Sectors"):
                self._add_segments(number, at, line["Sectors"])

    def _add_segments(self, number: str, at: float, sectors: Any) -> None:
        current = self._segments.setdefault(number, [[], [], []])
        changed = False
        for k, sector in _items(sectors):
            if not 0 <= k < 3 or not isinstance(sector, dict):
                continue
            row = current[k]
            for j, segment in _items(sector.get("Segments")):
                status = segment.get("Status") if isinstance(segment, dict) else None
                if not isinstance(status, int) or j < 0 or j > 64:
                    continue
                row.extend([0] * (j + 1 - len(row)))
                row[j] = status
                changed = True
        if changed:
            self._set(number, "segments", at, encode_segments(current))

    def segment_columns(self, codes: dict[str, str]) -> dict[str, dict[str, list]]:
        """Every change of the mini-sectors per driver code: {"VER": {"t": [..], "s": [..]}}."""
        out = {}
        for number, logs in list(self.cars.items()):
            changes = logs.get("segments")
            if changes is not None and number in codes:
                times = [round(t, 3) for t in changes.times]
                out[codes[number]] = {"t": times, "s": list(changes.values)}
        return out

    def add_tyres(self, at: float, data: dict[str, Any]) -> None:
        """A TimingAppData message: the compound and age of the newest stint."""
        for number, line in (data.get("Lines") or {}).items():
            stints = line.get("Stints") if isinstance(line, dict) else None
            items = stints.items() if isinstance(stints, dict) else enumerate(stints or [])
            newest = max(((int(k), v) for k, v in items if isinstance(v, dict)), default=None)
            if newest is None:
                continue
            stint = newest[1]
            if isinstance(stint.get("Compound"), str) and stint["Compound"] not in ("", "UNKNOWN"):
                self._set(number, "compound", at, stint["Compound"])
            if isinstance(stint.get("TotalLaps"), int):
                self._set(number, "tyre_age", at, stint["TotalLaps"])

    def at(self, t: float) -> dict[str, CarFeed]:
        out = {}
        for number, logs in list(self.cars.items()):
            value = {name: log.at(t) for name, log in list(logs.items())}
            car = CarFeed(
                position=value.get("position"),
                gap=value.get("gap"),
                interval=value.get("interval"),
                laps=value.get("laps"),
                pit_stops=value.get("pit_stops"),
                in_pit=bool(value.get("in_pit")),
                retired=bool(value.get("retired")),
                stopped=bool(value.get("stopped")),
                out=bool(value.get("out")),
                compound=value.get("compound"),
                tyre_age=value.get("tyre_age"),
                segments=value.get("segments"),
            )
            for name, v in value.items():
                if name.startswith("q") and name.endswith("_fastest"):
                    part = int(name[1:].split("_")[0])
                    car.parts[part] = (v, value.get(f"q{part}_ahead"))
            out[number] = car
        return out

    def next_change(self, t: float) -> float | None:
        i = bisect_right(self.changes, t)
        return self.changes[i] if i < len(self.changes) else None


class SegmentHistory:
    """The mini-sectors of a finished recording (FeedTower.segment_columns), per driver code."""

    def __init__(self, columns: dict[str, dict[str, list]]) -> None:
        self.drivers: dict[str, _Log] = {}
        changes: set[float] = set()
        for driver, values in columns.items():
            self.drivers[driver] = _Log(times=list(values["t"]), values=list(values["s"]))
            changes.update(values["t"])
        self.changes = sorted(changes)

    def at(self, t: float) -> dict[str, str | None]:
        return {driver: changes.at(t) for driver, changes in self.drivers.items()}

    def next_change(self, t: float) -> float | None:
        i = bisect_right(self.changes, t)
        return self.changes[i] if i < len(self.changes) else None


def with_segments(
    state: TimingState, segments: dict[str, str | None], next_change: float | None
) -> TimingState:
    """`state` with the mini-sectors of a finished recording (the rest is from the laps)."""
    rows = [
        row.model_copy(update={"segments": decode_segments(segments.get(row.driver))})
        for row in state.rows
    ]
    valid_until = _until(state, next_change)
    return state.model_copy(update={"rows": rows, "valid_until": valid_until})


def _until(state: TimingState, next_change: float | None) -> float | None:
    if next_change is None:
        return state.valid_until
    soon = max(next_change, state.time + MIN_VALID)
    return soon if state.valid_until is None else min(state.valid_until, soon)


_SECONDS = re.compile(r"\+?(?:(\d+):)?(\d+(?:\.\d+)?)")
_LAPS = re.compile(r"\+?(\d+)\s*L(?:APS?)?", re.IGNORECASE)


def parse_gap(text: str | None) -> tuple[float | None, int, bool]:
    """F1's gap text as (seconds, laps, leader): "+1.234", "+1:02.345", "1L", "2 LAPS", "LAP 36"
    (the leader, with its lap). Anything else (empty, unknown) is (None, 0, False)."""
    if not text:
        return None, 0, False
    text = text.strip()
    if text.upper().startswith("LAP"):
        return None, 0, True
    if m := _LAPS.fullmatch(text):
        return None, int(m.group(1)), False
    if m := _SECONDS.fullmatch(text):
        minutes = int(m.group(1) or 0)
        return round(minutes * 60 + float(m.group(2)), 3), 0, False
    return None, 0, False


def _empty_row(driver: str, car: CarFeed) -> TowerRow:
    """A car the laps do not have yet (a late recording, before its first timing line)."""
    return TowerRow(
        position=0,
        driver=driver,
        status="running",
        laps=car.laps or 0,
        gap=None,
        interval=None,
        laps_down=0,
        interval_laps=0,
        best_lap=None,
        best_timing="none",
        last_lap=None,
        last_timing="none",
        sectors=[TowerSector(time=None, timing="none", current=False) for _ in range(3)],
        compound=None,
        tyre_age=None,
        pit_stops=car.pit_stops or 0,
        eliminated=car.out,
    )


def overlay(
    state: TimingState,
    cars: dict[str, CarFeed],
    codes: dict[str, str],
    part: int | None = None,
    next_change: float | None = None,
) -> TimingState:
    """`state` (from the laps) with F1's order, gaps, intervals and status at the same time.
    `codes`: car number -> driver code; `part`: the qualifying part (0 = Q1)."""
    by_code = {codes[n]: car for n, car in cars.items() if n in codes}
    rows = list(state.rows)
    known = {row.driver for row in rows}
    rows += [_empty_row(code, car) for code, car in by_code.items() if code not in known]
    order = {row.driver: i for i, row in enumerate(rows)}

    def place(row: TowerRow) -> tuple[int, int]:
        car = by_code.get(row.driver)
        position = car.position if car is not None and car.position is not None else 999
        return position, order[row.driver]

    rows.sort(key=place)
    for i, row in enumerate(rows):
        row.position = i + 1
        car = by_code.get(row.driver)
        if car is None:
            continue
        row.status = _status(row.status, car)
        if car.laps is not None and state.kind == "race":
            row.laps = max(row.laps, car.laps)
        if row.compound is None and car.compound is not None:
            row.compound, row.tyre_age = car.compound, car.tyre_age
        if car.out:
            row.eliminated = True
        row.segments = decode_segments(car.segments)
        if state.kind == "quali":
            gap, interval = car.parts.get(part or 0, (None, None))
        else:
            gap, interval = car.gap, car.interval
        _set_gaps(row, gap, interval, first=i == 0)
    lap = state.lap
    if state.kind == "race" and rows and state.total_laps:
        lap = min(rows[0].laps + 1, state.total_laps)
    valid_until = _until(state, next_change)
    return state.model_copy(update={"rows": rows, "lap": lap, "valid_until": valid_until})


def _status(status: CarStatus, car: CarFeed) -> CarStatus:
    if car.retired or car.stopped:
        return "retired" if status != "finished" else status
    if car.in_pit and status in ("running", "out_lap", "in_lap"):
        return "pit"
    return status


def _set_gaps(row: TowerRow, gap: str | None, interval: str | None, first: bool) -> None:
    if first:
        row.gap = row.interval = None
        row.laps_down = row.interval_laps = 0
        return
    seconds, laps, _ = parse_gap(gap)
    if seconds is not None or laps:
        row.gap, row.laps_down = seconds, laps
    seconds, laps, _ = parse_gap(interval)
    if seconds is not None or laps:
        row.interval, row.interval_laps = seconds, laps
