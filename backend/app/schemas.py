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


class DriverInfo(BaseModel):
    code: str
    number: str
    first_name: str
    last_name: str
    team: str
    color: str
    """Team colour as #rrggbb."""
    headshot_url: str | None


class SessionDetail(BaseModel):
    year: int
    round: int
    code: SessionCode
    event_name: str
    session_name: str
    has_drs: bool
    """False from 2026 on (active aero replaced DRS)."""
    drivers: list[DriverInfo]


class Lap(BaseModel):
    driver: str
    lap: int
    lap_time: float | None
    """Seconds; null for laps without a time (out-laps, aborted laps)."""
    sector_1: float | None
    sector_2: float | None
    sector_3: float | None
    compound: str | None
    tyre_life: int | None
    fresh_tyre: bool | None
    stint: int | None
    personal_best: bool
    deleted: bool
    deleted_reason: str | None
    accurate: bool
    """FastF1's timing sync check; inaccurate laps should not be used for pace analysis."""
    pit_in: bool
    pit_out: bool
    track_status: str | None
    """All track status codes during the lap, e.g. '1' (clear) or '124' (incl. SC)."""
    quali_segment: str | None
    position: int | None
    speed_i1: float | None
    speed_i2: float | None
    speed_finish: float | None
    speed_trap: float | None
    """km/h at the speed traps."""
    start_time: float | None
    """Session time (s) at the start of the lap."""


class Telemetry(BaseModel):
    """One lap, columnar, at the source sample rate (~4 Hz car data merged with position)."""

    driver: str
    lap: int
    distance: list[float]
    time: list[float]
    speed: list[float]
    throttle: list[float]
    brake: list[int]
    gear: list[int]
    rpm: list[float]
    drs: list[int] | None
    x: list[float]
    y: list[float]


class ComparedLap(BaseModel):
    """A lap resampled onto the comparison's shared distance grid."""

    driver: str
    lap: int
    lap_time: float | None
    time: list[float]
    delta: list[float]
    """Seconds behind the reference (first) lap; positive = slower."""
    speed: list[float]
    throttle: list[float]
    brake: list[int]
    gear: list[int]
    rpm: list[float]
    drs: list[int] | None
    x: list[float]
    y: list[float]


class MiniSectors(BaseModel):
    boundaries: list[float]
    """count + 1 distances (m) on the reference lap, from 0 to lap length."""
    times: list[list[float]]
    """Per compared lap: seconds spent in each mini-sector."""
    fastest: list[int]
    """Per mini-sector: index into laps of the quickest lap."""


class CornerLap(BaseModel):
    """One lap through one corner segment."""

    time: float
    """Seconds spent in the segment."""
    brake_at: float | None
    """Distance (m) where braking starts; null if the lap does not brake here."""
    min_speed: float
    min_speed_at: float
    throttle_at: float | None
    """Distance (m) where throttle is back above 95% after the slowest point."""
    top_speed: float
    """Highest speed after the slowest point (km/h)."""


class CornerSegment(BaseModel):
    """A corner (or chicane) with its braking zone and the straight after it."""

    label: str
    """'T4', or 'T8–10' for corners taken as one."""
    start: float
    end: float
    laps: list[CornerLap]
    """One per compared lap, same order as Comparison.laps."""


class Comparison(BaseModel):
    distance: list[float]
    """Shared grid (m), stretched to the reference lap's length."""
    laps: list[ComparedLap]
    mini_sectors: MiniSectors
    corners: list[CornerSegment]
    """Empty when the circuit has no corner data."""


class Corner(BaseModel):
    label: str
    distance: float
    x: float
    y: float
    angle: float


class Circuit(BaseModel):
    name: str | None
    rotation: float
    """Degrees to rotate x/y by so the map matches the official orientation."""
    track_x: list[float]
    track_y: list[float]
    corners: list[Corner]
    pit_loss: float | None
    pit_loss_sc: float | None
    pit_loss_vsc: float | None
    """Estimated seconds lost by a pit stop (green flag / SC / VSC)."""
