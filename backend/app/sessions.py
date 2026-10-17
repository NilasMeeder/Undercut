"""Session data access: resolves API paths to archive folders and converts to API schemas.

Everything is memoised in-process; the source layer caches raw files on disk.
"""

import re
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any

import numpy as np

from app import analysis, schedule
from app.schemas import (
    Circuit,
    Corner,
    DriverInfo,
    Lap,
    RaceControlMessage,
    SessionDetail,
    Weather,
)
from app.sources import tracinginsights as ti

FASTEST = "fastest"
DRS_REMOVED_FROM = 2026
"""Active aero replaced DRS; the archive still has a drs column but it is meaningless."""

TRACE_CHANNELS = {
    "speed": "speed",
    "throttle": "throttle",
    "brake": "brake",
    "gear": "gear",
    "rpm": "rpm",
    "drs": "drs",
    "x": "x",
    "y": "y",
}
"""API channel name -> archive telemetry key."""


@lru_cache(maxsize=64)
def folders(year: int, round_number: int, code: str) -> tuple[str, str]:
    event, session = schedule.resolve_session(year, round_number, code)
    return event.name, session.name


def has_drs(year: int) -> bool:
    return year < DRS_REMOVED_FROM


@lru_cache(maxsize=16)
def get_detail(year: int, round_number: int, code: str) -> SessionDetail:
    event, session = folders(year, round_number, code)
    drivers = [
        DriverInfo(
            code=d["driver"],
            number=str(d["dn"]),
            first_name=d.get("fn") or "",
            last_name=d.get("ln") or "",
            team=d.get("team") or "",
            color=f"#{d['tc']}" if d.get("tc") else "#888888",
            headshot_url=ti.clean(d.get("url")),
        )
        for d in ti.drivers(year, event, session)
    ]
    return SessionDetail(
        year=year,
        round=round_number,
        code=code,
        event_name=event,
        session_name=session,
        has_drs=has_drs(year),
        drivers=drivers,
    )


def _as_bool(value: Any) -> bool:
    return value is True or value == "True"


@lru_cache(maxsize=16)
def get_laps(year: int, round_number: int, code: str) -> list[Lap]:
    event, session = folders(year, round_number, code)
    cols = ti.session_laps(year, event, session)
    laps = []
    for i in range(len(cols["lap"])):
        row = {key: values[i] for key, values in cols.items()}
        laps.append(
            Lap(
                driver=row["drv"],
                lap=int(row["lap"]),
                lap_time=row.get("time"),
                sector_1=row.get("s1"),
                sector_2=row.get("s2"),
                sector_3=row.get("s3"),
                compound=row.get("compound"),
                tyre_life=row.get("life"),
                fresh_tyre=row.get("fresh"),
                stint=row.get("stint"),
                personal_best=_as_bool(row.get("pb")),
                deleted=_as_bool(row.get("del")),
                deleted_reason=row.get("delR") or None,
                accurate=_as_bool(row.get("iacc")),
                pit_in=row.get("pin") is not None,
                pit_out=row.get("pout") is not None,
                track_status=None if row.get("status") is None else str(row["status"]),
                quali_segment=row.get("qs"),
                position=row.get("pos"),
                speed_i1=row.get("vi1"),
                speed_i2=row.get("vi2"),
                speed_finish=row.get("vfl"),
                speed_trap=row.get("vst"),
                start_time=row.get("lST"),
                end_time=row.get("sesT"),
                sector_1_end=row.get("s1T"),
                sector_2_end=row.get("s2T"),
                pit_in_time=row.get("pin"),
                pit_out_time=row.get("pout"),
            )
        )
    return laps


def fastest_lap(laps: list[Lap], driver: str) -> int:
    """The driver's quickest lap that counts: timed and not deleted."""
    timed = [
        lap for lap in laps if lap.driver == driver and lap.lap_time is not None and not lap.deleted
    ]
    if not timed:
        raise LookupError(f"{driver} has no timed laps in this session")
    return min(timed, key=lambda lap: lap.lap_time).lap


def parse_lap_refs(spec: str) -> list[tuple[str, int | str]]:
    """Parse 'VER:17,NOR:fastest' into [('VER', 17), ('NOR', 'fastest')]."""
    refs: list[tuple[str, int | str]] = []
    for part in filter(None, (p.strip() for p in spec.split(","))):
        driver, _, lap = part.partition(":")
        driver = driver.upper()
        if len(driver) != 3 or not driver.isalpha():
            raise ValueError(f"Invalid driver code in '{part}'")
        lap = lap.lower() or FASTEST
        if lap != FASTEST and not lap.isdigit():
            raise ValueError(f"Invalid lap in '{part}': use a number or 'fastest'")
        refs.append((driver, lap if lap == FASTEST else int(lap)))
    if not refs:
        raise ValueError("No laps given")
    return refs


def resolve_lap(year: int, round_number: int, code: str, driver: str, lap: int | str) -> int:
    if lap == FASTEST:
        return fastest_lap(get_laps(year, round_number, code), driver)
    return int(lap)


@lru_cache(maxsize=256)
def get_trace(year: int, round_number: int, code: str, driver: str, lap: int) -> analysis.LapTrace:
    event, session = folders(year, round_number, code)
    tel = ti.lap_telemetry(year, event, session, driver, lap)
    channels = {
        name: np.asarray(tel[key], dtype=float)
        for name, key in TRACE_CHANNELS.items()
        if key in tel and (name != "drs" or has_drs(year))
    }
    return analysis.LapTrace(
        distance=np.asarray(tel["distance"], dtype=float),
        time=np.asarray(tel["time"], dtype=float),
        channels=channels,
    )


def lap_time(year: int, round_number: int, code: str, driver: str, lap: int) -> float | None:
    for row in get_laps(year, round_number, code):
        if row.driver == driver and row.lap == lap:
            return row.lap_time
    return None


@lru_cache(maxsize=16)
def get_circuit(year: int, round_number: int, code: str) -> Circuit:
    event, session = folders(year, round_number, code)
    data = ti.corners(year, event, session)
    track_x, track_y = data.get("TrackX") or [], data.get("TrackY") or []
    if not track_x:
        # No MultiViewer outline for this circuit: draw the session's fastest lap instead.
        laps = [
            lap for lap in get_laps(year, round_number, code) if lap.lap_time and not lap.deleted
        ]
        best = min(laps, key=lambda lap: lap.lap_time)
        trace = get_trace(year, round_number, code, best.driver, best.lap)
        track_x, track_y = trace.channels["x"].tolist(), trace.channels["y"].tolist()

    labels = data.get("CornerLabel") or [str(n) for n in data.get("CornerNumber", [])]
    corners = [
        Corner(label=label, distance=dist, x=x, y=y, angle=angle)
        for label, dist, x, y, angle in zip(
            labels,
            data.get("Distance", []),
            data.get("X", []),
            data.get("Y", []),
            data.get("Angle", []),
            strict=False,
        )
    ]
    return Circuit(
        name=data.get("CircuitName"),
        rotation=float(data.get("Rotation") or 0.0),
        track_x=track_x,
        track_y=track_y,
        corners=corners,
        pit_loss=data.get("PitLossNormal"),
        pit_loss_sc=data.get("PitLossSC"),
        pit_loss_vsc=data.get("PitLossVSC"),
    )


def _optional_int(value: Any) -> int | None:
    try:
        return None if value is None else int(value)
    except (TypeError, ValueError):
        return None


_CAR_IN_MESSAGE = re.compile(r"\bCAR \d+ \(([A-Z]{3})\)")
"""'CAR 55 (SAI) TIME 1:20.470 DELETED …': the archive leaves dNum empty for these."""


def _utc(value: str) -> datetime:
    """'2025-09-06T14:04:17.000000000' (nanoseconds, no zone) -> aware UTC datetime."""
    return datetime.fromisoformat(value[:26]).replace(tzinfo=UTC)


@lru_cache(maxsize=16)
def get_t0(year: int, round_number: int, code: str) -> datetime | None:
    """UTC at session time 0. Every lap has its start in both clocks (lST and lSD); the difference
    is the same for every lap of a session, so the median only guards against a stray value."""
    event, session = folders(year, round_number, code)
    cols = ti.session_laps(year, event, session)
    offsets = [
        _utc(date).timestamp() - start
        for date, start in zip(cols.get("lSD", []), cols.get("lST", []), strict=False)
        if date is not None and start is not None
    ]
    if not offsets:
        return None
    return datetime.fromtimestamp(float(np.median(offsets)), tz=UTC)


@lru_cache(maxsize=16)
def get_race_control(year: int, round_number: int, code: str) -> list[RaceControlMessage]:
    event, session = folders(year, round_number, code)
    cols = ti.race_control(year, event, session)
    by_number = {d.number: d.code for d in get_detail(year, round_number, code).drivers}
    t0 = get_t0(year, round_number, code)
    messages = []
    for i in range(len(cols.get("msg", []))):
        number = _optional_int(cols["dNum"][i])
        driver = by_number.get(str(number)) if number is not None else None
        if driver is None and (match := _CAR_IN_MESSAGE.search(cols["msg"][i] or "")):
            driver = match.group(1)
        utc = _utc(cols["time"][i])
        messages.append(
            RaceControlMessage(
                utc=utc,
                session_time=None if t0 is None else round((utc - t0).total_seconds(), 3),
                category=cols["cat"][i] or "Other",
                message=cols["msg"][i] or "",
                flag=cols["flag"][i],
                scope=cols["scope"][i],
                sector=_optional_int(cols["sector"][i]),
                driver=driver,
                lap=_optional_int(cols["lap"][i]),
            )
        )
    return messages


@lru_cache(maxsize=16)
def get_weather(year: int, round_number: int, code: str) -> Weather:
    event, session = folders(year, round_number, code)
    cols = ti.weather(year, event, session)
    return Weather(
        time=cols["wT"],
        air_temp=cols["wAT"],
        track_temp=cols["wTT"],
        humidity=cols["wH"],
        pressure=cols["wP"],
        rainfall=[_as_bool(v) for v in cols["wR"]],
        wind_speed=cols["wWS"],
        wind_direction=[int(v) for v in cols["wWD"]],
    )
