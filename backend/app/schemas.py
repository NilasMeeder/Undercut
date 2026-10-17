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
    end_time: float | None
    sector_1_end: float | None
    sector_2_end: float | None
    """Session time (s) when the car crossed the line and the end of S1 and S2."""
    pit_in_time: float | None
    pit_out_time: float | None
    """Session time (s) of pit entry (on the in-lap) and pit exit (on the out-lap)."""


class RaceControlMessage(BaseModel):
    utc: datetime
    session_time: float | None
    """The same moment in session time (s); null if the session has no lap timing."""
    category: str
    """Flag, Other, CarEvent, Drs, SafetyCar, …"""
    message: str
    flag: str | None
    """GREEN, YELLOW, DOUBLE YELLOW, RED, BLUE, CHEQUERED, CLEAR, …"""
    scope: str | None
    """Track, Sector or Driver."""
    sector: int | None
    driver: str | None
    """Driver code when the message is about one car."""
    lap: int | None


class Weather(BaseModel):
    """Columnar, about one sample per minute."""

    time: list[float]
    """Session time (s), the same clock as Lap.start_time."""
    air_temp: list[float]
    track_temp: list[float]
    """°C."""
    humidity: list[float]
    """%."""
    pressure: list[float]
    """hPa (mbar)."""
    rainfall: list[bool]
    wind_speed: list[float]
    """m/s."""
    wind_direction: list[int]
    """Degrees, 0 = north."""


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


TrackStatus = Literal["green", "yellow", "sc", "vsc", "vsc_ending", "red", "chequered"]


class StatusPeriod(BaseModel):
    start: float
    end: float
    status: TrackStatus


class Segment(BaseModel):
    """A qualifying part (Q1, Q2, Q3) in session time."""

    name: str
    start: float
    end: float


class SessionTimeline(BaseModel):
    """What the session clock needs: its range, the laps and the track status over time."""

    start: float
    end: float
    """Session time (s) of the first lap start and the last lap end."""
    t0_utc: datetime | None
    """UTC at session time 0: utc = t0_utc + session time."""
    kind: Literal["race", "quali", "practice"]
    total_laps: int | None
    """Race distance in laps (races and sprints only)."""
    lap_starts: list[float]
    """Session time at which the leader started each lap (races and sprints only)."""
    segments: list[Segment]
    track_status: list[StatusPeriod]


ReplayState = Literal["missing", "loading", "ready", "error"]


class ReplayStatus(BaseModel):
    """Preparing the position track: every lap's telemetry is downloaded once (~10 s for a race)."""

    state: ReplayState
    progress: float
    """0 to 1."""
    phase: str | None
    """What is happening now, e.g. 'Downloading telemetry'."""
    error: str | None


class CarTrack(BaseModel):
    driver: str
    x: list[int | None]
    y: list[int | None]
    """Position (archive units, as in Telemetry.x/y); null when the car is not on track."""
    progress: list[float | None]
    """Laps driven: 12.25 = a quarter into lap 13. The fraction is the position along the lap."""


class ReplayPositions(BaseModel):
    """Every car on a fixed time grid: sample i is at session time start + i * step."""

    start: float
    step: float
    count: int
    lap_length: float
    """Metres; the typical distance of a lap in this session."""
    cars: list[CarTrack]


CarStatus = Literal["running", "out_lap", "in_lap", "pit", "garage", "retired", "finished"]
TimingClass = Literal["best", "pb", "none"]


class TowerSector(BaseModel):
    time: float | None
    timing: TimingClass
    """As it was at that moment: overall best, personal best, or neither."""
    current: bool
    """True for a sector of the lap in progress; false if it is still the previous lap's."""


class TowerRow(BaseModel):
    position: int
    driver: str
    status: CarStatus
    laps: int
    """Laps completed."""
    gap: float | None
    interval: float | None
    """Seconds to the leader and to the car ahead: in a race at the last timing line passed, in
    qualifying and practice the difference in best lap time."""
    laps_down: int
    """Race: laps behind the leader (gap is then null)."""
    interval_laps: int
    best_lap: float | None
    best_timing: TimingClass
    last_lap: float | None
    last_timing: TimingClass
    sectors: list[TowerSector]
    compound: str | None
    tyre_age: int | None
    pit_stops: int
    eliminated: bool
    """Qualifying: knocked out in an earlier part."""


class TimingState(BaseModel):
    """The timing tower at session time `time`, valid from valid_from until valid_until."""

    time: float
    valid_from: float | None
    valid_until: float | None
    """The last and next moment anything changes; null before the first and after the last."""
    kind: Literal["race", "quali", "practice"]
    lap: int | None
    """Race: the leader's current lap."""
    total_laps: int | None
    segment: str | None
    cutoff: int | None
    """Qualifying: how many drivers go through to the next part."""
    track_status: TrackStatus
    rows: list[TowerRow]
