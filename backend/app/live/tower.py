"""The timing tower as F1 sends it (TimingData), laid over the one worked out from the laps.

While a session is live the laps come from a conversion every few seconds, so the tower from the
laps runs up to ~4 s behind, and a recording that started late has no laps (no order, no gaps)
for a car until it crosses a timing line. TimingData has F1's own order, gaps and intervals the
moment they change, and its state at subscription has them for every car. Sectors, tyres and
purple/green stay from the laps, where they mean what they mean in the archive.
"""

import re
from bisect import bisect_right
from dataclasses import dataclass, field
from typing import Any

from app.schemas import CarStatus, TimingState, TowerRow, TowerSector

MIN_VALID = 0.25
"""Seconds a tower answer stays valid at least: the feed changes many times a second."""

_FLAGS = {"InPit": "in_pit", "Retired": "retired", "Stopped": "stopped", "KnockedOut": "out"}


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
        if state.kind == "quali":
            gap, interval = car.parts.get(part or 0, (None, None))
        else:
            gap, interval = car.gap, car.interval
        _set_gaps(row, gap, interval, first=i == 0)
    lap = state.lap
    if state.kind == "race" and rows and state.total_laps:
        lap = min(rows[0].laps + 1, state.total_laps)
    valid_until = state.valid_until
    if next_change is not None:
        soon = max(next_change, state.time + MIN_VALID)
        valid_until = soon if valid_until is None else min(valid_until, soon)
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
