from datetime import datetime
from typing import Literal

from pydantic import BaseModel

SessionCode = Literal["FP1", "FP2", "FP3", "SQ", "SS", "S", "Q", "R"]


class SessionInfo(BaseModel):
    code: SessionCode
    name: str
    """Full FastF1 session name, e.g. 'Sprint Qualifying'."""
    start_utc: datetime | None


class EventInfo(BaseModel):
    round: int
    name: str
    country: str
    location: str
    format: str
    """FastF1 event format: conventional, sprint, sprint_shootout, sprint_qualifying."""
    date: datetime
    sessions: list[SessionInfo]


class SeasonEvents(BaseModel):
    year: int
    events: list[EventInfo]
