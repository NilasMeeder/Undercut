"""Live timing messages -> FastF1 Session -> the archive's file shapes (TracingInsights columns).

FastF1 has years of fixes for the quirks of the timing feed, and TracingInsights is built with
FastF1, so laps from a recording mean exactly what laps from the archive mean. FastF1 only reads a
recording as a whole; we hand it the parsed messages directly (LiveTimingData without files), which
also keeps the state sent at subscription time that FastF1's own file reader skips.
"""

import logging
from collections.abc import Iterable
from datetime import datetime, timedelta
from typing import Any

import fastf1
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
        data.setdefault(message.topic, []).append([at, message.data])
    livedata = LiveTimingData()
    livedata.data = data
    livedata._files_read = True
    livedata._start_date = origin
    return livedata


def load_session(
    year: int, round_number: int, code: str, livedata: LiveTimingData, telemetry: bool
) -> fastf1.core.Session:
    session = fastf1.get_session(year, round_number, code)
    session.load(laps=True, telemetry=telemetry, weather=True, messages=True, livedata=livedata)
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


def lap_columns(session: fastf1.core.Session, origin: datetime) -> dict[str, list[Any]]:
    """session.laps as session_laptimes.json columns, None for missing (the archive's "None").
    Session time 0 is `origin` (see live_timing_data)."""
    # FastF1 makes up a last lap for cars it thinks retired on track; without a classification
    # (there is none during a session) that includes every lapped car. The archive has real laps.
    laps = session.laps[~session.laps["FastF1Generated"].astype(bool)]
    start = _seconds(laps["LapStartTime"])
    cols: dict[str, list[Any]] = {
        "time": _seconds(laps["LapTime"]),
        "lap": _ints(laps["LapNumber"]),
        "compound": [c or None for c in _plain(laps["Compound"])],
        "stint": _ints(laps["Stint"]),
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
        "pout": _seconds(laps["PitOutTime"]),
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


def session_time(utc: datetime, origin: datetime) -> float:
    return (utc - origin) / timedelta(seconds=1)
