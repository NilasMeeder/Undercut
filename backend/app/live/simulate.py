"""Turn an archived session into a live timing recording, to test the live path without a session.

    uv run python -m app.live.simulate 2025 16 R --speed 8

writes the messages F1 would have streamed into the session's live recording, paced like the real
thing (sped up), so the backend sees a session in progress. `--speed 0` writes everything at once.

The messages follow the topics and shapes FastF1's parsers read (fastf1/_api.py): TimingData per
timing point (sectors, lap times, lap count, pit in/out, speed traps, positions and gaps),
TimingAppData stints, Position.z and CarData.z at 4 Hz, TrackStatus, RaceControlMessages,
WeatherData, LapCount and the session status. What the archive does not have (positions before the
start, cars in the garage) is not simulated.
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

from app import replays, sessions
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
        out += self._weather()
        out += self._lap_count()
        out += self._samples()
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
                    out.append(line(number, lap.pit_in_time, {"InPit": True}))

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


def lines(sim: Simulation) -> Iterator[tuple[float, str]]:
    """(session time, line) in the order F1 would send them."""
    for topic, data in sim.initial_state().items():
        yield sim.begin, feed.state_line(topic, data)
    for update in sim.updates():
        yield update.at, feed.update_line(update.topic, update.data, sim.utc(update.at))


def write(sim: Simulation, path: Path, speed: float, start: float | None = None) -> None:
    """Write the recording; with speed > 0 paced like a live session from `start` (session time)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    began = time.monotonic()
    origin = start if start is not None else sim.begin
    with path.open("w") as f:
        for at, text in lines(sim):
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
        write(sim, path, args.speed, args.start)
    except KeyboardInterrupt:
        print("Stopped")


def sessions_init() -> None:
    from app import schedule

    schedule.init_cache()


if __name__ == "__main__":
    main()
