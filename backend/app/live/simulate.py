"""Turn an archived session into a live timing recording, to test the live path without a session.

    uv run python -m app.live.simulate 2025 16 R --speed 8

writes the messages F1 would have streamed into the session's live recording, paced like the real
thing (sped up), so the backend sees a session in progress. `--speed 0` writes everything at once.

The messages follow the topics and shapes FastF1's parsers read (fastf1/_api.py): TimingData per
timing point (sectors, lap times, lap count, pit in/out, speed traps, positions and gaps) and per
mini-sector (Segments, made up from the telemetry: F1's timing loops are not in the archive),
TimingAppData stints, Position.z and CarData.z at 4 Hz, TrackStatus, RaceControlMessages,
WeatherData, LapCount, ExtrapolatedClock and the session status. What the archive does not have
(positions before the start, cars in the garage) is not simulated.
"""

import argparse
import math
import time
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np

from app import replay, replays, sessions
from app.live import feed, recordings
from app.schemas import Lap
from app.sources import tracinginsights as ti

LEAD_IN = 60.0
"""Seconds of feed before the first lap starts (cars on the grid, pit exit open)."""
SAMPLE_STEP = 0.25
"""Car data and positions: F1 sends ~4 Hz, a few samples per message."""
BATCH = 1.0
HEARTBEAT = 15.0
MAX_GAP = 2.0
"""Telemetry gaps longer than this (garage, missing laps) are not filled in."""
SEGMENT_LENGTH = 260.0
"""Metres per simulated mini-sector (F1 has some 6-10 per sector, at its timing loops)."""
SEGMENT_STATUS = {"slow": 2048, "pb": 2049, "best": 2051, "pit": 2064}

STATUS_CODES = {
    "green": ("1", "AllClear"),
    "yellow": ("2", "Yellow"),
    "sc": ("4", "SCDeployed"),
    "red": ("5", "Red"),
    "vsc": ("6", "VSCDeployed"),
    "vsc_ending": ("7", "VSCEnding"),
}
SESSION_TYPES = {"race": "Race", "quali": "Qualifying", "practice": "Practice"}


@dataclass(frozen=True)
class Update:
    at: float
    """Session time (s)."""
    topic: str
    data: Any


def lap_time(seconds: float) -> str:
    minutes, rest = divmod(seconds, 60)
    return f"{int(minutes)}:{rest:06.3f}" if minutes else f"{rest:.3f}"


def clock_time(seconds: float) -> str:
    """4679.0 -> '01:17:59', as ExtrapolatedClock sends it."""
    whole = round(seconds)
    return f"{whole // 3600:02d}:{whole % 3600 // 60:02d}:{whole % 60:02d}"


def gap(seconds: float) -> str:
    return f"+{seconds:.3f}"


class Simulation:
    def __init__(self, year: int, round_number: int, code: str):
        self.key = (year, round_number, code)
        self.event, self.session = sessions.folders(year, round_number, code)
        self.detail = sessions.get_detail(*self.key)
        self.laps = [lap for lap in sessions.get_laps(*self.key) if lap.end_time is not None]
        self.timeline = replays.get_timeline(*self.key)
        t0 = self.timeline.t0_utc
        if t0 is None:
            raise LookupError("The archive has no UTC time for this session")
        self.t0 = t0
        self.number = {d.code: d.number for d in self.detail.drivers}
        self.begin = self.timeline.start - LEAD_IN
        self.started = self.timeline.start
        self.end = self.timeline.end
        self.grid = replays.starting_grid(*self.key)
        self.paths: dict[tuple[str, int], tuple[np.ndarray, np.ndarray]] = {}
        """(driver, lap) -> time since the lap start and distance, filled by _telemetry."""

    def utc(self, at: float) -> datetime:
        return self.t0 + timedelta(seconds=at)

    # --- the state sent right after subscribing --------------------------------------------------

    def initial_state(self) -> dict[str, Any]:
        kind = self.timeline.kind
        drivers = {}
        order = sorted(
            self.detail.drivers, key=lambda d: (self.grid.get(d.code, 99), d.number.zfill(3))
        )
        for line, d in enumerate(order, start=1):
            drivers[d.number] = {
                "RacingNumber": d.number,
                "BroadcastName": f"{d.first_name[:1]} {d.last_name}".upper(),
                "FullName": f"{d.first_name} {d.last_name}",
                "Tla": d.code,
                "Line": line,
                "TeamName": d.team,
                "TeamColour": d.color.lstrip("#"),
                "FirstName": d.first_name,
                "LastName": d.last_name,
                "HeadshotUrl": d.headshot_url,
            }
        state: dict[str, Any] = {
            "SessionInfo": {
                "Meeting": {"Name": self.event, "Location": "", "Country": {"Name": ""}},
                "Type": SESSION_TYPES[kind],
                "Name": self.session,
                "StartDate": self.utc(self.started).strftime("%Y-%m-%dT%H:%M:%S"),
                "EndDate": self.utc(self.end).strftime("%Y-%m-%dT%H:%M:%S"),
                "GmtOffset": "00:00:00",
                "Path": f"{self.key[0]}/{self.event}/{self.session}/",
            },
            "DriverList": drivers,
            "TimingData": {
                "Lines": {
                    number: {
                        "RacingNumber": number,
                        "Line": d["Line"],
                        "Position": str(d["Line"]),
                        "InPit": True,
                        "PitOut": False,
                        "Stopped": False,
                        "Retired": False,
                    }
                    for number, d in drivers.items()
                }
            },
            "TimingAppData": {"Lines": {n: {"RacingNumber": n, "Stints": []} for n in drivers}},
            "TrackStatus": {"Status": "1", "Message": "AllClear"},
            "SessionStatus": {"Status": "Inactive"},
            "SessionData": {"Series": [], "StatusSeries": []},
            "Heartbeat": {"Utc": feed.format_utc(self.utc(self.begin))},
            "RaceControlMessages": {"Messages": []},
            "TeamRadio": {"Captures": []},
        }
        if kind == "race":
            state["LapCount"] = {"CurrentLap": 1, "TotalLaps": self.timeline.total_laps}
        return state

    # --- streamed updates ------------------------------------------------------------------------

    def updates(self) -> list[Update]:
        out: list[Update] = []
        out += self._session_status()
        out += self._timing()
        out += self._track_status()
        out += self._race_control()
        out += self._team_radio()
        out += self._weather()
        out += self._lap_count()
        out += self._clock()
        out += self._standings()
        out += self._samples()
        out += self._segments()  # after _samples: it reads the telemetry
        out += [
            Update(at, "Heartbeat", {"Utc": feed.format_utc(self.utc(at))})
            for at in np.arange(self.begin + HEARTBEAT, self.end + 30, HEARTBEAT)
        ]
        out.sort(key=lambda u: u.at)
        return out

    def _session_status(self) -> list[Update]:
        started, finished = self.started, self.end + 1.0
        series = {
            "StatusSeries": {
                "0": {"Utc": feed.format_utc(self.utc(started)), "SessionStatus": "Started"}
            }
        }
        out = [
            Update(started, "SessionStatus", {"Status": "Started"}),
            Update(started, "SessionData", series),
        ]
        # Q2 and Q3: the session stops and starts again, and the timing data starts a new set of
        # best laps (FastF1 splits qualifying on that).
        segments = self.timeline.segments
        for n, (previous, segment) in enumerate(zip(segments, segments[1:], strict=False), 1):
            restart = segment.start - 1.0
            out.append(Update(previous.end + 1.0, "SessionStatus", {"Status": "Finished"}))
            out.append(Update(restart, "SessionStatus", {"Status": "Started"}))
            for number in self.number.values():
                best = {"BestLapTimes": {str(n): {"Value": ""}}}
                out.append(Update(restart, "TimingData", {"Lines": {number: best}}))
        return out + [
            Update(finished, "SessionStatus", {"Status": "Finished"}),
            Update(finished + 20, "SessionStatus", {"Status": "Finalised"}),
            Update(finished + 25, "SessionStatus", {"Status": "Ends"}),
        ]

    def _timing(self) -> list[Update]:
        out: list[Update] = []
        by_driver: dict[str, list[Lap]] = {}
        for lap in self.laps:
            by_driver.setdefault(lap.driver, []).append(lap)

        # Gaps at each line crossing, to the first car over the line on that lap.
        first_over: dict[int, float] = {}
        for lap in self.laps:
            first_over[lap.lap] = min(first_over.get(lap.lap, math.inf), lap.end_time)
        crossings = sorted(((lap.end_time, lap) for lap in self.laps), key=lambda c: c[0])
        previous_crossing: dict[int, float] = {}

        def line(number: str, at: float, data: dict[str, Any]) -> Update:
            return Update(at, "TimingData", {"Lines": {number: data}})

        def app(number: str, at: float, stint: int, data: dict[str, Any]) -> Update:
            return Update(at, "TimingAppData", {"Lines": {number: {"Stints": {str(stint): data}}}})

        race = self.timeline.kind == "race"
        for driver, laps in by_driver.items():
            number = self.number.get(driver)
            if number is None:
                continue
            laps.sort(key=lambda lap: lap.lap)
            best = math.inf
            stops = 0
            stints_sent: set[int] = set()
            if race and laps[0].pit_out_time is None:
                # On the grid: the car left the pit lane before the lead-in started.
                out.append(line(number, self.begin + 1, {"InPit": False, "PitOut": False}))
            for lap in laps:
                stint = (lap.stint or 1) - 1
                stint_at = lap.pit_out_time if lap.pit_out_time is not None else self.begin + 2
                if lap.pit_out_time is not None:
                    out.append(line(number, lap.pit_out_time, {"InPit": False, "PitOut": True}))
                if stint not in stints_sent and lap.compound is not None:
                    stints_sent.add(stint)
                    start_laps = max((lap.tyre_life or 1) - 1, 0)
                    fresh = "true" if lap.fresh_tyre else "false"
                    out.append(
                        app(
                            number,
                            stint_at,
                            stint,
                            {
                                "Compound": lap.compound,
                                "New": fresh,
                                "TyresNotChanged": "0",
                                "TotalLaps": start_laps,
                                "StartLaps": start_laps,
                            },
                        )
                    )
                if lap.sector_1_end is not None and lap.sector_1 is not None:
                    data: dict[str, Any] = {"Sectors": {"0": {"Value": f"{lap.sector_1:.3f}"}}}
                    if lap.speed_i1 is not None:
                        data["Speeds"] = {"I1": {"Value": str(round(lap.speed_i1))}}
                    out.append(line(number, lap.sector_1_end, data))
                if lap.sector_2_end is not None and lap.sector_2 is not None:
                    data = {"Sectors": {"1": {"Value": f"{lap.sector_2:.3f}"}}}
                    if lap.speed_i2 is not None:
                        data["Speeds"] = {"I2": {"Value": str(round(lap.speed_i2))}}
                    out.append(line(number, lap.sector_2_end, data))
                if lap.pit_in_time is not None:
                    stops += 1
                    data = {"InPit": True, "NumberOfPitStops": stops}
                    out.append(line(number, lap.pit_in_time, data))

                data = {"NumberOfLaps": lap.lap}
                if lap.sector_3 is not None:
                    data["Sectors"] = {"2": {"Value": f"{lap.sector_3:.3f}"}}
                data["LastLapTime"] = {
                    "Value": lap_time(lap.lap_time) if lap.lap_time is not None else ""
                }
                speeds = {
                    key: {"Value": str(round(value))}
                    for key, value in (("FL", lap.speed_finish), ("ST", lap.speed_trap))
                    if value is not None
                }
                if speeds:
                    data["Speeds"] = speeds
                counts = not (race and lap.lap == 1)  # no personal best from the standing start
                if counts and lap.lap_time is not None and not lap.deleted and lap.lap_time < best:
                    best = lap.lap_time
                    data["BestLapTime"] = {"Value": lap_time(best), "Lap": lap.lap}
                if race and lap.position is not None:
                    data["Position"] = str(lap.position)
                    data["Line"] = lap.position
                    data["GapToLeader"] = (
                        f"LAP {lap.lap + 1}"
                        if lap.position == 1
                        else gap(lap.end_time - first_over[lap.lap])
                    )
                out.append(line(number, lap.end_time, data))
                if lap.tyre_life is not None:
                    out.append(
                        app(
                            number,
                            lap.end_time,
                            stint,
                            {"TotalLaps": lap.tyre_life, "LapNumber": lap.lap},
                        )
                    )

        # Intervals: to the car that crossed the line just before, on the same lap.
        for end, lap in crossings:
            ahead = previous_crossing.get(lap.lap)
            previous_crossing[lap.lap] = end
            number = self.number.get(lap.driver)
            if ahead is None or number is None or not race:
                continue
            interval = {"IntervalToPositionAhead": {"Value": gap(end - ahead)}}
            out.append(line(number, end, interval))
        return out

    def _standings(self) -> list[Update]:
        """Qualifying and practice: F1's order and differences at every line crossing, as the
        archive's tower has them (races send them with the timing points, see _timing)."""
        if self.timeline.kind == "race":
            return []
        index = replays.get_timing_index(*self.key)
        moments = sorted({lap.end_time for lap in self.laps} | {s.start for s in index.segments})
        sent: dict[str, dict[str, Any]] = {}
        out = []
        for at in moments:
            state = replay.timing_state(index, at)
            part = int(state.segment[-1]) - 1 if state.segment else None
            lines = {}
            for row in state.rows:
                number = self.number.get(row.driver)
                if number is None:
                    continue
                fastest = gap(row.gap) if row.gap is not None else ""
                ahead = gap(row.interval) if row.interval is not None else ""
                line: dict[str, Any] = {"Position": str(row.position), "Line": row.position}
                if part is None:
                    line |= {"TimeDiffToFastest": fastest, "TimeDiffToPositionAhead": ahead}
                else:
                    stats = {"TimeDiffToFastest": fastest, "TimeDifftoPositionAhead": ahead}
                    line |= {"Stats": {str(part): stats}, "KnockedOut": row.eliminated}
                changed = {k: v for k, v in line.items() if sent.get(number, {}).get(k) != v}
                if changed:
                    sent.setdefault(number, {}).update(changed)
                    lines[number] = changed
            if lines:
                out.append(Update(at, "TimingData", {"Lines": lines}))
        return out

    def _track_status(self) -> list[Update]:
        out = []
        current = "green"
        for period in self.timeline.track_status:
            status = period.status if period.status in STATUS_CODES else "green"
            if status != current:
                code, message = STATUS_CODES[status]
                out.append(
                    Update(period.start, "TrackStatus", {"Status": code, "Message": message})
                )
                current = status
        return out

    def _race_control(self) -> list[Update]:
        try:
            cols = ti.race_control(self.key[0], self.event, self.session)
        except ti.SourceNotAvailable:
            return []
        out = []
        for i in range(len(cols.get("msg", []))):
            utc = sessions._utc(cols["time"][i])
            entry: dict[str, Any] = {
                "Utc": feed.format_utc(utc),
                "Category": cols["cat"][i] or "Other",
                "Message": cols["msg"][i] or "",
            }
            for key, column in (
                ("Flag", "flag"),
                ("Scope", "scope"),
                ("Sector", "sector"),
                ("RacingNumber", "dNum"),
                ("Lap", "lap"),
                ("Status", "status"),
            ):
                if cols[column][i] is not None:
                    entry[key] = cols[column][i]
            at = (utc - self.t0).total_seconds()
            out.append(
                Update(max(at, self.begin), "RaceControlMessages", {"Messages": {str(i): entry}})
            )
        return out

    def _team_radio(self) -> list[Update]:
        """The archive's clips as F1 sends them: a capture per update, the path relative to the
        session (the simulated SessionInfo path does not exist at F1; the archive has the audio)."""
        try:
            cols = ti.fetch_json(self.key[0], self.event, self.session, "team_radio.json")
        except ti.SourceNotAvailable:
            return []
        out = []
        for i, (number, date, file) in enumerate(
            zip(cols.get("dNum", []), cols.get("date", []), cols.get("file", []), strict=False)
        ):
            utc = datetime.fromisoformat(str(date))
            capture = {
                "Utc": feed.format_utc(utc),
                "RacingNumber": str(number),
                "Path": f"TeamRadio/{str(file).rsplit('/', 1)[-1]}",
            }
            at = (utc - self.t0).total_seconds()
            out.append(Update(max(at, self.begin), "TeamRadio", {"Captures": {str(i): capture}}))
        return out

    def _weather(self) -> list[Update]:
        try:
            w = sessions.get_weather(*self.key)
        except ti.SourceNotAvailable:
            return []
        out = []
        for i, at in enumerate(w.time):
            if at < self.begin or at > self.end:
                continue
            data = {
                "AirTemp": f"{w.air_temp[i]:.1f}",
                "Humidity": f"{w.humidity[i]:.1f}",
                "Pressure": f"{w.pressure[i]:.1f}",
                "Rainfall": "1" if w.rainfall[i] else "0",
                "TrackTemp": f"{w.track_temp[i]:.1f}",
                "WindDirection": str(w.wind_direction[i]),
                "WindSpeed": f"{w.wind_speed[i]:.1f}",
            }
            out.append(Update(at, "WeatherData", data))
        return out

    def _clock(self) -> list[Update]:
        """ExtrapolatedClock at each point of the archive's worked-out session clock."""
        return [
            Update(
                p.t,
                "ExtrapolatedClock",
                {
                    "Utc": feed.format_utc(self.utc(p.t)),
                    "Remaining": clock_time(p.remaining),
                    "Extrapolating": p.running,
                },
            )
            for p in self.timeline.clock
        ]

    def _lap_count(self) -> list[Update]:
        if self.timeline.kind != "race" or not self.timeline.total_laps:
            return []
        total = self.timeline.total_laps
        return [
            Update(at, "LapCount", {"CurrentLap": n})
            for n, at in enumerate(self.timeline.lap_starts, start=1)
            if 1 < n <= total
        ]

    def _samples(self) -> list[Update]:
        """Position.z and CarData.z on one 4 Hz grid, a second of samples per message."""
        grid = np.arange(self.begin, self.end, SAMPLE_STEP)
        cars = {}
        for driver, number in self.number.items():
            channels = self._telemetry(driver)
            if channels is not None:
                cars[number] = _on_grid(channels, grid)
        out = []
        per_batch = round(BATCH / SAMPLE_STEP)
        for first in range(0, len(grid), per_batch):
            index = range(first, min(first + per_batch, len(grid)))
            positions, car_data = [], []
            for i in index:
                stamp = feed.format_utc(self.utc(float(grid[i])))
                entries, channels = {}, {}
                for number, values in cars.items():
                    if not values["valid"][i]:
                        continue
                    entries[number] = {
                        "Status": "OnTrack",
                        "X": int(values["x"][i]),
                        "Y": int(values["y"][i]),
                        "Z": int(values["z"][i]),
                    }
                    channels[number] = {
                        "Channels": {
                            "0": int(values["rpm"][i]),
                            "2": int(values["speed"][i]),
                            "3": int(values["gear"][i]),
                            "4": int(values["throttle"][i]),
                            "5": 100 if values["brake"][i] else 0,
                            "45": 12 if values["drs"][i] else 0,
                        }
                    }
                if entries:
                    positions.append({"Timestamp": stamp, "Entries": entries})
                    car_data.append({"Utc": stamp, "Cars": channels})
            if positions:
                at = float(grid[index[-1]]) + 0.05
                out.append(Update(at, "Position.z", feed.deflate({"Position": positions})))
                out.append(Update(at + 0.01, "CarData.z", feed.deflate({"Entries": car_data})))
        return out

    def _segments(self) -> list[Update]:
        """F1's mini-sectors: each sector split into equal parts of the lap distance, with the
        status F1 gives the moment a car passes the end of one (overall best, personal best,
        neither, pit lane). Passing the first one of a lap clears the rest of the lap before."""
        bounds = self._segment_bounds()
        if bounds is None:
            return []
        passages: list[tuple[float, str, int, int, float | None]] = []
        for lap in self.laps:
            number = self.number.get(lap.driver)
            path = self.paths.get((lap.driver, lap.lap))
            if number is None or path is None or lap.start_time is None or not replay.driven(lap):
                continue  # a car that did not start has a lap without times (and telemetry)
            time, distance = path
            reach = np.maximum.accumulate(distance)
            ends = np.interp(np.concatenate(bounds) * reach[-1], reach, time)
            if lap.end_time is not None:
                ends[-1] = lap.end_time - lap.start_time
            starts = np.concatenate([[0.0], ends[:-1]])
            index = [(k, j) for k, row in enumerate(bounds) for j in range(len(row))]
            for (k, j), begin, end in zip(index, starts, ends, strict=True):
                at = lap.start_time + float(end)
                # The lap of a car leaving the pits starts at the pit exit: its first segment
                # is still the pit lane.
                left_pit = lap.pit_out_time is not None and (at < lap.pit_out_time or k == j == 0)
                in_pit = left_pit or (lap.pit_in_time is not None and at > lap.pit_in_time)
                passages.append((at, number, k, j, None if in_pit else float(end - begin)))
        passages.sort(key=lambda p: p[0])
        overall: dict[tuple[int, int], float] = {}
        own: dict[tuple[str, int, int], float] = {}
        out = []
        for at, number, k, j, seconds in passages:
            if seconds is None:
                status = SEGMENT_STATUS["pit"]
            elif seconds < overall.get((k, j), math.inf):
                status = SEGMENT_STATUS["best"]
            elif seconds < own.get((number, k, j), math.inf):
                status = SEGMENT_STATUS["pb"]
            else:
                status = SEGMENT_STATUS["slow"]
            if seconds is not None:
                overall[(k, j)] = min(overall.get((k, j), math.inf), seconds)
                own[(number, k, j)] = min(own.get((number, k, j), math.inf), seconds)
            sectors: dict[str, Any] = {str(k): {"Segments": {str(j): {"Status": status}}}}
            if (k, j) == (0, 0):  # a new lap: the bars of the lap before go
                for kk, row in enumerate(bounds):
                    segments = sectors.setdefault(str(kk), {"Segments": {}})["Segments"]
                    for jj in range(len(row)):
                        segments.setdefault(str(jj), {"Status": 0})
            out.append(Update(at, "TimingData", {"Lines": {number: {"Sectors": sectors}}}))
        return out

    def _segment_bounds(self) -> list[np.ndarray] | None:
        """Per sector the ends of its mini-sectors as a fraction of the lap, from the fastest lap
        with both sector times and telemetry."""
        laps = sorted(
            (lap for lap in self.laps if lap.lap_time is not None),
            key=lambda lap: lap.lap_time or math.inf,
        )
        for lap in laps:
            path = self.paths.get((lap.driver, lap.lap))
            if (
                path is None
                or lap.start_time is None
                or None
                in (
                    lap.sector_1_end,
                    lap.sector_2_end,
                )
            ):
                continue
            time, distance = path
            reach = np.maximum.accumulate(distance)
            length = float(reach[-1])
            sector_ends = [
                float(np.interp(end - lap.start_time, time, reach)) / length
                for end in (lap.sector_1_end or 0.0, lap.sector_2_end or 0.0)
            ] + [1.0]
            bounds, begin = [], 0.0
            for end in sector_ends:
                count = max(3, round((end - begin) * length / SEGMENT_LENGTH))
                bounds.append(np.linspace(begin, end, count + 1)[1:])
                begin = end
            return bounds
        return None

    def _telemetry(self, driver: str) -> dict[str, np.ndarray] | None:
        year, event, session = self.key[0], self.event, self.session
        parts: dict[str, list[np.ndarray]] = {}
        for lap in self.laps:
            if lap.driver != driver or lap.start_time is None:
                continue
            try:
                tel = ti.lap_telemetry(year, event, session, driver, lap.lap)
            except ti.SourceNotAvailable:
                continue
            parts.setdefault("time", []).append(lap.start_time + np.asarray(tel["time"], float))
            if tel.get("distance"):
                path = np.asarray(tel["time"], float), np.asarray(tel["distance"], float)
                self.paths[(driver, lap.lap)] = path
            for key in ("x", "y", "z", "speed", "rpm", "gear", "throttle", "brake", "drs"):
                values = tel.get(key) or [0] * len(tel["time"])
                parts.setdefault(key, []).append(
                    np.asarray([0 if v is None or v == "None" else v for v in values], float)
                )
        if not parts:
            return None
        merged = {key: np.concatenate(values) for key, values in parts.items()}
        order = np.argsort(merged["time"], kind="stable")
        merged = {key: values[order] for key, values in merged.items()}
        keep = np.concatenate([[True], np.diff(merged["time"]) > 0])
        return {key: values[keep] for key, values in merged.items()}


def _on_grid(channels: dict[str, np.ndarray], grid: np.ndarray) -> dict[str, np.ndarray]:
    t = channels["time"]
    after = np.searchsorted(t, grid)
    before = np.clip(after - 1, 0, len(t) - 1)
    after = np.clip(after, 0, len(t) - 1)
    valid = (grid >= t[0]) & (grid <= t[-1]) & (t[after] - t[before] <= MAX_GAP)
    out = {"valid": valid}
    for key in ("x", "y", "z", "speed", "rpm", "throttle"):
        out[key] = np.interp(grid, t, channels[key])
    for key in ("gear", "brake", "drs"):
        out[key] = channels[key][before]
    return out


def _merge(state: dict[str, Any], update: dict[str, Any]) -> None:
    for key, value in update.items():
        if isinstance(value, dict) and isinstance(state.get(key), dict):
            _merge(state[key], value)
        else:
            state[key] = value


def _as_lists(value: Any) -> Any:
    """F1 sends arrays in its state as lists, in updates as dicts keyed "0", "1", ..."""
    if not isinstance(value, dict):
        return value
    out = {key: _as_lists(v) for key, v in value.items()}
    if out and all(k.isdigit() for k in out) and sorted(map(int, out)) == list(range(len(out))):
        return [out[str(i)] for i in range(len(out))]
    return out


def lines(sim: Simulation, join: float | None = None) -> Iterator[tuple[float, str]]:
    """(session time, line) in the order F1 would send them. `join`: the recording starts at that
    session time, with F1's state of that moment (everything before merged) instead."""
    state = sim.initial_state()
    updates = sim.updates()
    if join is not None:
        for update in updates:
            if update.at > join:
                break
            if update.topic not in TELEMETRY and isinstance(update.data, dict):
                _merge(state.setdefault(update.topic, {}), update.data)
        updates = [u for u in updates if u.at > join]
        state = {topic: _as_lists(data) for topic, data in state.items()}
    begin = sim.begin if join is None else join
    for topic, data in state.items():
        yield begin, feed.state_line(topic, data)
    for update in updates:
        yield update.at, feed.update_line(update.topic, update.data, sim.utc(update.at))


TELEMETRY = ("Position.z", "CarData.z")


def write(
    sim: Simulation,
    path: Path,
    speed: float,
    start: float | None = None,
    join: float | None = None,
) -> None:
    """Write the recording; with speed > 0 paced like a live session from `start` (session time)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    began = time.monotonic()
    origin = start if start is not None else join if join is not None else sim.begin
    with path.open("w") as f:
        for at, text in lines(sim, join):
            if speed > 0 and at > origin:
                wait = (at - origin) / speed - (time.monotonic() - began)
                if wait > 0:
                    f.flush()
                    time.sleep(wait)
            f.write(text + "\n")
        f.flush()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("year", type=int)
    parser.add_argument("round", type=int)
    parser.add_argument("session", help="FP1 FP2 FP3 SQ S Q R")
    parser.add_argument("--speed", type=float, default=1.0, help="0 = all at once")
    parser.add_argument("--start", type=float, help="Session time (s) to start pacing from")
    parser.add_argument(
        "--join", type=float, help="Start the recording late, at this session time (s)"
    )
    parser.add_argument("--out", type=Path, help="Default: the session's live recording")
    args = parser.parse_args()
    sessions_init()
    ti.READ_LIVE = False  # the archive, not an earlier simulation of it
    sim = Simulation(args.year, args.round, args.session)
    path = args.out
    if path is None:
        recordings.write_meta(args.year, args.round, args.session, sim.event, sim.session)
        path = recordings.recording_path(args.year, sim.event, sim.session)
    pace = args.speed or "instant"
    print(f"Writing {path} ({sim.event} {sim.session}, speed {pace})", flush=True)
    try:
        write(sim, path, args.speed, args.start, args.join)
    except KeyboardInterrupt:
        print("Stopped")


def sessions_init() -> None:
    from app import schedule

    schedule.init_cache()


if __name__ == "__main__":
    main()
