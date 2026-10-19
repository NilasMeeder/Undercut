"""Live timing messages -> FastF1 Session -> the archive's file shapes (TracingInsights columns).

FastF1 has years of fixes for the quirks of the timing feed, and TracingInsights is built with
FastF1, so laps from a recording mean exactly what laps from the archive mean. FastF1 only reads a
recording as a whole; we hand it the parsed messages directly (LiveTimingData without files), which
also keeps the state sent at subscription time that FastF1's own file reader skips.
"""

import contextlib
import logging
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from unittest import mock

import fastf1
import fastf1._api
import numpy as np
import pandas as pd
from fastf1.livetiming.data import LiveTimingData

from app.live.feed import Message, parse_utc

log = logging.getLogger(__name__)

TELEMETRY_TOPICS = ("CarData.z", "Position.z")


def started_utc(messages: Iterable[Message]) -> datetime | None:
    """When the session status first went to Started (from SessionData, which also carries it in
    the state sent at subscription time)."""
    for message in messages:
        if message.topic != "SessionData" or not isinstance(message.data, dict):
            continue
        series = message.data.get("StatusSeries") or []
        entries = series.values() if isinstance(series, dict) else series
        for entry in entries:
            if isinstance(entry, dict) and entry.get("SessionStatus") == "Started":
                return parse_utc(entry.get("Utc", ""))
    return None


LATE_FIELDS = ("NumberOfLaps", "LastLapTime", "Sectors", "Speeds")
"""What F1's state says about the laps before it; FastF1 makes a lap of it (see joined_late)."""


STARTED = ("Started", "Aborted", "Finished", "Finalised", "Ends")
"""Session statuses in the state of a recording that started during (or after) the session."""


@dataclass(frozen=True)
class Joined:
    """A recording that started during the session (see joined_late)."""

    laps: dict[str, int]
    """Per car number: laps completed before the recording."""
    pit_stops: dict[str, int]
    """Per car number: pit stops before the recording (FastF1 counts stints by pit stops)."""
    utc: datetime
    """When the recording started (its first timed message)."""
    started: datetime | None = None
    """When the session started (F1's state has it): lap 1 of a race starts then."""


def joined_late(messages: list[Message]) -> tuple[list[Message], Joined | None]:
    """A recording that starts during the session; F1's state then says what happened before.
    FastF1 reads it as if it all happened when the recording started, so the state is changed
    first, and lap_columns corrects the laps with what is returned:
    - FastF1 counts laps itself from 1 and starts one wherever NumberOfLaps goes up: the lap count
      and the last lap's times in the state would make a lap that ends now, with the times of the
      lap after it (values up to 5 s after a lap start count for the lap before). Taken out, so
      the first line crossing ends FastF1's lap 1; add the laps before to its numbers.
    - FastF1 only counts laps once a car has left the pits: those cars have (InPit false), also
      when they are in the pits now. That shows as a pit exit when the recording starts.
    - Tyres: all stints in the state seem to start now. Only the current one stays, with its age
      as the start age, so the tyre life goes on from there. FastF1 numbers stints by the pit
      stops it saw: add the ones before (NumberOfPitStops)."""
    first = next((i for i, m in enumerate(messages) if m.topic == "TimingData"), None)
    utc = next((m.utc for m in messages if m.utc is not None), None)
    if first is None or utc is None or messages[first].utc is not None:
        return messages, None
    state = messages[first].data if isinstance(messages[first].data, dict) else {}
    laps: dict[str, int] = {}
    stops: dict[str, int] = {}
    lines: dict[str, Any] = {}
    for number, line in (state.get("Lines") or {}).items():
        count = line.get("NumberOfLaps") if isinstance(line, dict) else None
        if isinstance(count, int) and count > 0:
            laps[number] = count
            if isinstance(line.get("NumberOfPitStops"), int):
                stops[number] = line["NumberOfPitStops"]
            line = {k: v for k, v in line.items() if k not in LATE_FIELDS} | {"InPit": False}
        lines[number] = line
    status = next((m for m in messages if m.topic == "SessionStatus"), None)
    started = (
        status is not None
        and status.utc is None
        and isinstance(status.data, dict)
        and status.data.get("Status") in STARTED
    )
    if not laps and not started:
        return messages, None
    out = list(messages)
    out[first] = Message(messages[first].topic, {**state, "Lines": lines}, None)
    tyres = next((i for i, m in enumerate(out) if m.topic == "TimingAppData"), None)
    if tyres is not None and out[tyres].utc is None and isinstance(out[tyres].data, dict):
        app = out[tyres].data
        app_lines = {}
        for number, line in (app.get("Lines") or {}).items():
            stints = line.get("Stints") if isinstance(line, dict) else None
            if number in laps and isinstance(stints, list) and stints:
                current = dict(stints[-1])
                if isinstance(current.get("TotalLaps"), int):
                    current["StartLaps"] = current["TotalLaps"]
                line = {**line, "Stints": {str(len(stints) - 1): current}}
            app_lines[number] = line
        out[tyres] = Message(out[tyres].topic, {**app, "Lines": app_lines}, None)
    return out, Joined(laps=laps, pit_stops=stops, utc=utc, started=started_utc(messages))


def live_timing_data(
    messages: list[Message], origin: datetime, skip: tuple[str, ...] = ()
) -> LiveTimingData:
    """FastF1's container for recorded data, filled from parsed messages; session time 0 =
    `origin`. State messages (no time) get the time of the message before them, or of the first
    streamed one."""
    first = next((m.utc for m in messages if m.utc is not None), origin)
    last: datetime | None = None
    data: dict[str, list[list[Any]]] = {}
    for message in messages:
        if message.utc is not None:
            last = message.utc
        if message.topic in skip:
            continue
        # The state is resent after a reconnect: it holds from where the recording was then.
        at = (message.utc or last or first) - origin
        if message.utc is None and message.topic == "DriverList":
            # FastF1 skips drivers listed more than an hour in (late entries): not the state.
            at = min(at, timedelta(0))
        data.setdefault(message.topic, []).append([at, message.data])
    livedata = LiveTimingData()
    livedata.data = data
    livedata._files_read = True
    livedata._start_date = origin
    return livedata


def load_session(
    year: int,
    round_number: int,
    code: str,
    livedata: LiveTimingData,
    telemetry: bool,
    joined: bool = False,
) -> fastf1.core.Session:
    """FastF1's Session from recorded data. `joined`: the recording started during the session
    (see joined_late)."""
    session = fastf1.get_session(year, round_number, code)
    # FastF1 also asks Ergast for results and (races) the first lap times on every load: during a
    # session there are none yet, uncached that is two requests per conversion (jolpica allows
    # ~500 an hour), and lap 1 of a late recording is not the race's lap 1.
    session._drivers_results_from_ergast = lambda *args, **kwargs: None
    session._add_first_lap_time_from_ergast = lambda: None
    with contextlib.ExitStack() as stack:
        if joined:
            # FastF1 aligns the drivers' laps on its own lap numbers, which in a late recording
            # are different laps for a lapped car than for the leader: a shift of a whole lap.
            stack.enter_context(mock.patch.object(fastf1._api, "_align_laps", lambda *a: None))
        # A topic not in the recording (yet) FastF1 would fetch from F1's archive instead.
        session.load(
            laps=True,
            telemetry=telemetry,
            weather=livedata.has("WeatherData"),
            messages=livedata.has("RaceControlMessages"),
            livedata=livedata,
        )
    return session


def _seconds(series: pd.Series) -> list[float | None]:
    values = series.dt.total_seconds().to_numpy()
    return [None if np.isnan(v) else round(float(v), 3) for v in values]


def _plain(series: pd.Series) -> list[Any]:
    out = []
    for value in series.tolist():
        if value is None or (isinstance(value, float) and np.isnan(value)) or value is pd.NaT:
            out.append(None)
        elif isinstance(value, np.generic):
            out.append(value.item())
        else:
            out.append(value)
    return out


def _ints(series: pd.Series) -> list[int | None]:
    return [None if v is None else int(v) for v in _plain(series)]


def _naive(utc: datetime) -> str:
    """The archive's date format: UTC without a zone, '2025-09-07T13:03:34.806000'."""
    return utc.strftime("%Y-%m-%dT%H:%M:%S.%f")


def lap_columns(
    session: fastf1.core.Session, origin: datetime, joined: Joined | None = None
) -> dict[str, list[Any]]:
    """session.laps as session_laptimes.json columns, None for missing (the archive's "None").
    Session time 0 is `origin` (see live_timing_data). `joined`: the recording started during the
    session (see joined_late)."""
    # FastF1 makes up a last lap for cars it thinks retired on track; without a classification
    # (there is none during a session) that includes every lapped car. The archive has real laps.
    laps = session.laps[~session.laps["FastF1Generated"].astype(bool)]
    start = _seconds(laps["LapStartTime"])
    numbers = _ints(laps["LapNumber"])
    pit_out = _seconds(laps["PitOutTime"])
    stints = _ints(laps["Stint"])
    if joined is not None:
        _correct_joined(session, laps, joined, origin, start, numbers, pit_out, stints)
    cols: dict[str, list[Any]] = {
        "time": _seconds(laps["LapTime"]),
        "lap": numbers,
        "compound": [c or None for c in _plain(laps["Compound"])],
        "stint": stints,
        "s1": _seconds(laps["Sector1Time"]),
        "s2": _seconds(laps["Sector2Time"]),
        "s3": _seconds(laps["Sector3Time"]),
        "life": _ints(laps["TyreLife"]),
        "pos": _ints(laps["Position"]),
        "status": _plain(laps["TrackStatus"]),
        "pb": _plain(laps["IsPersonalBest"]),
        "sesT": _seconds(laps["Time"]),
        "drv": _plain(laps["Driver"]),
        "dNum": _plain(laps["DriverNumber"]),
        "pout": pit_out,
        "pin": _seconds(laps["PitInTime"]),
        "s1T": _seconds(laps["Sector1SessionTime"]),
        "s2T": _seconds(laps["Sector2SessionTime"]),
        "s3T": _seconds(laps["Sector3SessionTime"]),
        "vi1": _plain(laps["SpeedI1"]),
        "vi2": _plain(laps["SpeedI2"]),
        "vfl": _plain(laps["SpeedFL"]),
        "vst": _plain(laps["SpeedST"]),
        "fresh": _plain(laps["FreshTyre"]),
        "team": _plain(laps["Team"]),
        "lST": start,
        # FastF1 dates laps from the telemetry, which this conversion leaves out.
        "lSD": [None if t is None else _naive(origin + timedelta(seconds=t)) for t in start],
        "del": _plain(laps["Deleted"]),
        "delR": [r or None for r in _plain(laps["DeletedReason"])],
        "iacc": _plain(laps["IsAccurate"]),
    }
    if session.name in ("Qualifying", "Sprint Qualifying", "Sprint Shootout"):
        cols["qs"] = _quali_segments(session, laps)
    return cols


def _correct_joined(
    session: fastf1.core.Session,
    laps: pd.DataFrame,
    joined: Joined,
    origin: datetime,
    start: list[float | None],
    numbers: list[int | None],
    pit_out: list[float | None],
    stints: list[int | None],
) -> None:
    """Lap and stint numbers, the first lap's start and the made-up pit exit of a late recording,
    in place (see joined_late)."""
    began = session_time(joined.utc, origin)
    race = session.name in ("Race", "Sprint")
    drivers = _plain(laps["DriverNumber"])
    ends, times = _seconds(laps["Time"]), _seconds(laps["LapTime"])
    race_start = session_time(joined.started, origin) if joined.started is not None else None
    at_start = lambda t: t is not None and abs(t - began) < 1.0  # noqa: E731
    for i, (number, lap) in enumerate(zip(drivers, numbers, strict=True)):
        # Every car out on track "leaves the pits" as the recording starts (on the lap after if
        # a lap ends within 5 s), and its lap so far seems to start then.
        # The first lap of a car that drove before (its start can be before the recording).
        before = joined.laps.get(str(number), 0)
        if at_start(pit_out[i]):
            pit_out[i] = None
        if at_start(start[i]) or (before and lap == 1):
            end, time = ends[i], times[i]
            start[i] = None if end is None or time is None else round(end - time, 3)
            if not before and lap == 1 and race and race_start is not None:
                start[i] = round(race_start, 3)
        if before and lap is not None:
            numbers[i] = lap + before
            if stints[i] is not None:
                stints[i] += joined.pit_stops.get(str(number), 0)


def _quali_segments(session: fastf1.core.Session, laps: pd.DataFrame) -> list[str | None]:
    names = ("Q1", "Q2", "Q3") if session.name == "Qualifying" else ("SQ1", "SQ2", "SQ3")
    segment: dict[int, str] = {}
    try:
        parts = laps.split_qualifying_sessions()
    except Exception:  # FastF1 raises several kinds when the split points are missing
        log.warning("Could not split the qualifying sessions", exc_info=True)
        return [None] * len(laps)
    for part, name in zip(parts, names, strict=False):
        if part is not None:
            for index in part.index:
                segment[index] = name
    return [segment.get(index) for index in laps.index]


def driver_rows(session: fastf1.core.Session) -> list[dict[str, Any]]:
    """drivers.json rows."""
    rows = []
    for _, r in session.results.iterrows():
        if not r.get("Abbreviation"):
            continue
        rows.append(
            {
                "driver": r["Abbreviation"],
                "team": r.get("TeamName") or "",
                "dn": str(r["DriverNumber"]),
                "fn": r.get("FirstName") or "",
                "ln": r.get("LastName") or "",
                "tc": r.get("TeamColor") or None,
                "url": r.get("HeadshotUrl") or None,
            }
        )
    return rows


def race_control_columns(session: fastf1.core.Session) -> dict[str, list]:
    """rcm.json columns; time as the archive writes it (UTC, no zone)."""
    rcm = session.race_control_messages
    return {
        "time": [_naive(pd.Timestamp(t)) for t in rcm["Time"]],
        "cat": _plain(rcm["Category"]),
        "msg": _plain(rcm["Message"]),
        "status": _plain(rcm["Status"]),
        "flag": _plain(rcm["Flag"]),
        "scope": _plain(rcm["Scope"]),
        "sector": [None if v is None else int(v) for v in _plain(rcm["Sector"])],
        "dNum": _plain(rcm["RacingNumber"]),
        "lap": [None if v is None else int(v) for v in _plain(rcm["Lap"])],
    }


def weather_columns(session: fastf1.core.Session) -> dict[str, list]:
    w = session.weather_data
    return {
        "wT": _seconds(w["Time"]),
        "wAT": _plain(w["AirTemp"]),
        "wTT": _plain(w["TrackTemp"]),
        "wH": _plain(w["Humidity"]),
        "wP": _plain(w["Pressure"]),
        "wR": _plain(w["Rainfall"]),
        "wWD": _plain(w["WindDirection"]),
        "wWS": _plain(w["WindSpeed"]),
    }


def _clock_seconds(value: Any) -> float | None:
    """'01:17:59' -> 4679.0."""
    try:
        hours, minutes, seconds = str(value).split(":")
        return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    except ValueError:
        return None


def clock_columns(messages: list[Message], origin: datetime) -> dict[str, list]:
    """F1's session clock (ExtrapolatedClock) as columns t, remaining, running. Each message is a
    reference point: `Remaining` at `Utc`, counting down while `Extrapolating`. Updates only carry
    what changed, so they are merged into the state before them."""
    state: dict[str, Any] = {}
    columns: dict[str, list] = {"t": [], "remaining": [], "running": []}
    for message in messages:
        if message.topic != "ExtrapolatedClock" or not isinstance(message.data, dict):
            continue
        state |= message.data
        utc = parse_utc(str(state.get("Utc", "")))
        remaining = _clock_seconds(state.get("Remaining"))
        if utc is None or remaining is None:
            continue
        columns["t"].append(round(session_time(utc, origin), 3))
        columns["remaining"].append(remaining)
        columns["running"].append(bool(state.get("Extrapolating", False)))
    return columns


STATIC = "https://livetiming.formula1.com/static/"


def team_radio_columns(messages: list[Message], numbers: dict[str, str]) -> dict[str, list]:
    """team_radio.json columns (as the archive has them) from F1's TeamRadio topic: the state is
    a list of captures, updates a dict by index; each has Utc, RacingNumber and Path (relative
    to the session's SessionInfo Path)."""
    base = ""
    captures: dict[str, dict] = {}
    for message in messages:
        if not isinstance(message.data, dict):
            continue
        if message.topic == "SessionInfo" and message.data.get("Path"):
            base = str(message.data["Path"])
        if message.topic != "TeamRadio":
            continue
        found = message.data.get("Captures")
        items = enumerate(found) if isinstance(found, list) else (found or {}).items()
        for key, capture in items:
            if isinstance(capture, dict):
                captures[str(key)] = captures.get(str(key), {}) | capture
    columns: dict[str, list] = {"drv": [], "dNum": [], "date": [], "file": [], "url": []}
    for capture in sorted(captures.values(), key=lambda c: str(c.get("Utc", ""))):
        number, path = str(capture.get("RacingNumber", "")), str(capture.get("Path", ""))
        driver, utc = numbers.get(number), parse_utc(str(capture.get("Utc", "")))
        if not driver or utc is None or not path:
            continue
        name = path.rsplit("/", 1)[-1]
        columns["drv"].append(driver)
        columns["dNum"].append(number)
        columns["date"].append(utc.isoformat())
        columns["file"].append(f"{driver}/radio/{name}")
        columns["url"].append(f"{STATIC}{base}{path}")
    return columns


def session_time(utc: datetime, origin: datetime) -> float:
    return (utc - origin) / timedelta(seconds=1)
