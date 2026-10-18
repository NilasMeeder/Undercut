"""Thin layer around FastF1: loading, caching and conversion to API schemas."""

from functools import lru_cache

import fastf1
import pandas as pd

from app.config import FASTF1_CACHE_DIR
from app.schemas import EventInfo, SeasonEvents, SessionInfo

SESSION_CODES = {
    "Practice 1": "FP1",
    "Practice 2": "FP2",
    "Practice 3": "FP3",
    "Sprint Qualifying": "SQ",
    "Sprint Shootout": "SS",
    "Sprint": "S",
    "Qualifying": "Q",
    "Race": "R",
}

MAX_SESSIONS_PER_EVENT = 5


def init_cache() -> None:
    FASTF1_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(FASTF1_CACHE_DIR))


def _optional_datetime(value: object) -> pd.Timestamp | None:
    return None if pd.isna(value) else pd.Timestamp(value).tz_localize("UTC")


def _utc_offset(value: object) -> int | None:
    """Minutes ahead of UTC of a local, offset-aware schedule time (FastF1's SessionXDate)."""
    if value is None or pd.isna(value):
        return None
    offset = pd.Timestamp(value).utcoffset()
    return None if offset is None else round(offset.total_seconds() / 60)


def schedule_to_events(schedule: pd.DataFrame) -> list[EventInfo]:
    events = []
    for _, row in schedule.iterrows():
        sessions = []
        for i in range(1, MAX_SESSIONS_PER_EVENT + 1):
            name = row.get(f"Session{i}")
            code = SESSION_CODES.get(name) if isinstance(name, str) else None
            if code is None:
                continue
            sessions.append(
                SessionInfo(
                    code=code,
                    name=name,
                    start_utc=_optional_datetime(row.get(f"Session{i}DateUtc")),
                    utc_offset=_utc_offset(row.get(f"Session{i}Date")),
                )
            )
        events.append(
            EventInfo(
                round=int(row["RoundNumber"]),
                name=row["EventName"],
                country=row["Country"],
                location=row["Location"],
                format=row["EventFormat"],
                date=pd.Timestamp(row["EventDate"]),
                sessions=sessions,
            )
        )
    return events


@lru_cache(maxsize=16)
def get_season_events(year: int) -> SeasonEvents:
    schedule = fastf1.get_event_schedule(year, include_testing=False)
    return SeasonEvents(year=year, events=schedule_to_events(schedule))


def resolve_session(year: int, round_number: int, code: str) -> tuple[EventInfo, SessionInfo]:
    """Look up the event and session for an API path; raises KeyError if unknown."""
    event = next((e for e in get_season_events(year).events if e.round == round_number), None)
    if event is None:
        raise KeyError(f"No round {round_number} in {year}")
    session = next((s for s in event.sessions if s.code == code), None)
    if session is None:
        raise KeyError(f"No session {code} at {event.name} {year}")
    return event, session
