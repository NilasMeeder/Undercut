from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Inputs may leave out fields with a default; responses always have them (required in the TS types).
_RESPONSE_DEFAULTS = ConfigDict(json_schema_serialization_defaults_required=True)

SessionCode = Literal["FP1", "FP2", "FP3", "SQ", "SS", "S", "Q", "R"]


class SessionInfo(BaseModel):
    code: SessionCode
    name: str
    """Full FastF1 session name, e.g. 'Sprint Qualifying'."""
    start_utc: datetime | None
    utc_offset: int | None
    """Local time at the circuit minus UTC, in minutes (Austin -300, Monza 120)."""


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


class ProgressReference(BaseModel):
    """The finished lap the lap in progress is measured against, on the same grid."""

    lap: int
    lap_time: float | None
    speed: list[float | None]


class LapProgress(BaseModel):
    """The lap a driver is on at session time t, as far as it got (replay: a finished lap cut off
    at t; live: the samples so far), on a distance grid over the reference lap with the delta to
    it. Values past where the car is are null, so a chart over the whole lap grows."""

    driver: str
    lap: int
    start: float
    """Session time (s) the lap started."""
    elapsed: float
    """Seconds into the lap at t (or as far as the samples go)."""
    progress: float
    """Metres into the lap, on the grid's scale."""
    out_lap: bool
    """First lap after a pit stop or out of the garage: the delta means little."""
    distance: list[float]
    """Grid (m), every 5 m."""
    time: list[float | None]
    speed: list[float | None]
    throttle: list[float | None]
    brake: list[int | None]
    gear: list[int | None]
    reference: ProgressReference | None
    delta: list[float | None]
    """Seconds behind the reference; positive = slower."""


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


class MarshalSector(BaseModel):
    """A marshal sector (yellow flags are per marshal sector) as a lap-distance range (m)."""

    number: int
    start: float
    end: float
    """Smaller than start for the sector over the start/finish line."""


class Circuit(BaseModel):
    name: str | None
    rotation: float
    """Degrees to rotate x/y by so the map matches the official orientation."""
    track_x: list[float]
    track_y: list[float]
    track_distance: list[float]
    """Lap distance (m) of each outline point, matched to the corners, for markers on the map."""
    lap_length: float
    """Metres, on the scale of track_distance."""
    corners: list[Corner]
    marshal_sectors: list[MarshalSector]
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


class SectorFlag(BaseModel):
    """A yellow flag in one marshal sector, from race control."""

    sector: int
    start: float
    end: float
    flag: Literal["yellow", "double_yellow"]


class ClockPoint(BaseModel):
    """F1's session clock from session time `t` on: `remaining` seconds, counting down if
    `running` (stopped under a red flag and between qualifying parts)."""

    t: float
    remaining: float
    running: bool


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
    first_lap: int
    """The lap number of lap_starts[0]: 1, unless a live recording started during the race."""
    segments: list[Segment]
    track_status: list[StatusPeriod]
    sector_flags: list[SectorFlag]
    clock: list[ClockPoint]
    """The session clock (time remaining): F1's own when recorded live, otherwise worked out from
    the qualifying parts (or the first lap of practice) and red flags. Empty for races."""


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
SegmentClass = Literal["best", "pb", "slow", "pit", "none"]
"""One of F1's mini-sectors (TimingData Segments): overall best, personal best, neither, driven
in the pit lane, or not yet driven on this lap."""


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
    segments: list[list[SegmentClass]] = Field(default_factory=list)
    """F1's own mini-sectors per sector as the official timing shows them, for the lap in
    progress; only in live recordings (empty for the archive)."""
    model_config = _RESPONSE_DEFAULTS


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


MarkerKind = Literal["distance", "time"]


class MarkerIn(BaseModel):
    """A marked point or range: lap distance (m) or session time (s). `end` null = a point."""

    kind: MarkerKind
    start: float
    end: float | None = None
    driver: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    lap: int | None = Field(default=None, ge=1)
    """With `driver`: the lap the marker is about (distance markers)."""
    note: str = Field(default="", max_length=500)
    tags: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("tags")
    @classmethod
    def _clean_tags(cls, tags: list[str]) -> list[str]:
        seen: dict[str, str] = {}
        for tag in tags:
            clean = " ".join(tag.split())[:32]
            if clean and clean.lower() not in seen:
                seen[clean.lower()] = clean
        return list(seen.values())

    @model_validator(mode="after")
    def _check(self) -> "MarkerIn":
        if self.end is not None and self.end < self.start:
            raise ValueError("end must not be before start")
        if self.kind == "distance" and self.start < 0:
            raise ValueError("a distance starts at 0 m or later")
        if self.lap is not None and self.driver is None:
            raise ValueError("a lap needs a driver")
        return self


class Marker(MarkerIn):
    model_config = _RESPONSE_DEFAULTS

    id: int
    year: int
    round: int
    session: SessionCode
    created: datetime
    updated: datetime


class TagCount(BaseModel):
    tag: str
    count: int


class ViewLap(BaseModel):
    driver: str
    lap: int


class ViewState(BaseModel):
    """What a saved view restores. The layout is dockview's JSON, opaque to the backend."""

    model_config = _RESPONSE_DEFAULTS

    laps: dict[str, list[ViewLap]] = Field(default_factory=dict)
    """Selected laps per link group."""
    zoom: dict[str, tuple[float, float]] = Field(default_factory=dict)
    """Distance range (m) per zoomed link group."""
    clock: float | None = None
    """Session time (s)."""
    layout: dict[str, Any] | None = None
    preset: str | None = None


class ViewIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    year: int
    round: int
    session: SessionCode
    state: ViewState


class View(ViewIn):
    id: int
    created: datetime
    updated: datetime


# --- Strategy (phase 6) --------------------------------------------------------------------------


class Stint(BaseModel):
    number: int
    compound: str | None
    fresh: bool | None
    start_lap: int
    end_lap: int
    """First and last lap on this set, the out-lap and in-lap included."""
    start_life: int | None
    """Tyre age (laps) on the first lap of the stint: 1 for a new set."""


class PitStop(BaseModel):
    lap: int
    """The in-lap; the car leaves the pit lane on the next lap."""
    pit_in: float
    pit_out: float
    """Session time (s) of pit entry and exit."""
    lane: float
    """Seconds from pit entry to pit exit."""
    loss: float | None
    """Seconds lost on the in-lap and out-lap together, against the driver's pace on the laps around
    them; null when one of those laps has no time."""
    status: TrackStatus
    """Track status at pit entry: a stop under SC or VSC costs less."""


class DriverRace(BaseModel):
    """One driver's race lap by lap, columnar: index i is lap laps[i]."""

    driver: str
    grid: int | None
    """Starting position (Jolpica); 99 for a pit-lane start, null when unknown."""
    laps: list[int]
    line: list[float | None]
    """Session time (s) at which the car crossed the line at the end of the lap."""
    gap: list[float | None]
    """Seconds behind the first car to complete that lap (race only)."""
    position: list[int | None]
    """Position at the end of the lap."""
    lap_time: list[float | None]
    tyre_life: list[int | None]
    """Tyre age (laps) on that lap."""
    clean: list[bool]
    """A racing lap that says something about pace: timed, not a pit lap or lap 1, no SC/VSC."""
    stints: list[Stint]
    stops: list[PitStop]


class RaceHistory(BaseModel):
    """The session lap by lap for every driver: what gap, position and stint charts need."""

    kind: Literal["race", "quali", "practice"]
    total_laps: int | None
    leader_line: list[float]
    """Per lap (index lap − 1): when the first car completed it."""
    drivers: list[DriverRace]
    """Classification order: most laps first, then who crossed the line first."""


class DegFit(BaseModel):
    """Fuel-corrected lap time = base + slope × tyre age, fitted on the stint's clean laps."""

    slope: float
    """Seconds per lap of tyre age: the degradation."""
    base: float
    """Fuel-corrected lap time (s) on a new tyre (age 0)."""
    residual: float
    """Standard deviation (s) of the clean laps around the fit."""
    laps: list[int]
    """The laps the fit used (clean laps, outliers removed)."""


class StintPace(BaseModel):
    driver: str
    stint: int
    compound: str | None
    start_lap: int
    end_lap: int
    fit: DegFit | None
    """Null with fewer than 4 clean laps."""


class CompoundPace(BaseModel):
    """The field's degradation on one compound: stint fits combined."""

    compound: str
    slope: float
    """Mean of the stint slopes, weighted by their laps."""
    base: float
    """Median of the stint bases."""
    stints: int
    laps: int


class Degradation(BaseModel):
    until: float | None
    """Only laps completed by this session time (s) were used; null = the whole session."""
    total_laps: int | None
    """The race distance, or the session's last lap outside races (the fuel reference)."""
    fuel_per_lap: float
    """Seconds a lap gets quicker by burning fuel. Fuel-corrected lap time =
    lap_time − fuel_per_lap × (total_laps − lap): the lap as if run with the last lap's fuel.
    Outside races the load is unknown: a burn of 1.8 kg/lap is assumed and total_laps is the
    session's last lap, so the slopes mean something but the levels only within a stint."""
    stints: list[StintPace]
    compounds: list[CompoundPace]


class Rejoin(BaseModel):
    """Where a car comes out after a pit stop now, if nobody else stops."""

    position: int
    ahead: str | None
    gap_ahead: float | None
    behind: str | None
    gap_behind: float | None
    """Seconds to the cars around the rejoin point."""


class Duel(BaseModel):
    """Undercut and overcut against one car around the driver.

    first[k − 1]: the driver stops on the next lap and the rival k laps later; second[k − 1]: the
    rival stops on the next lap and the driver k laps later. Both are seconds the driver gains on
    the rival once both have stopped (negative = loses), on top of the gap now.
    """

    rival: str
    ahead: bool
    """The rival is ahead of the driver now."""
    gap: float
    """Seconds between the two at the last line both crossed."""
    rival_compound: str | None
    rival_life: int | None
    first: list[float]
    second: list[float]


class PitWindow(BaseModel):
    """A pit stop for one driver at the cutoff: where he rejoins, and undercut/overcut on the cars
    ahead and behind. Tyre model from Degradation; pit loss from the circuit."""

    driver: str
    lap: int
    """Laps the driver had completed."""
    position: int
    compound: str | None
    life: int | None
    new_compound: str | None
    pit_loss: float
    status: TrackStatus
    """Track status at the cutoff; under SC or VSC the pit loss is smaller."""
    rejoin: Rejoin | None
    duels: list[Duel]
    notes: list[str]
    """Assumptions the numbers rest on, e.g. a compound nobody has run yet."""


LiveState = Literal["live", "recorded"]


class LiveSessionInfo(BaseModel):
    """A session recorded from the live timing feed (app/live), live or done."""

    year: int
    round: int
    code: SessionCode
    event_name: str
    session_name: str
    state: LiveState
    """live: the recording is still being written to."""
    horizon: float | None
    """Session time (s) of the newest data."""
    version: int
    """Goes up with every conversion of the feed: refetch the session's laps and strategy."""
    status: str | None
    """F1's session status: Inactive, Started, Aborted, Finished, Finalised, Ends."""
    error: str | None


class ScheduledSession(BaseModel):
    year: int
    round: int
    code: SessionCode
    event_name: str
    session_name: str
    start_utc: datetime


class RecorderStatus(BaseModel):
    """The live recorder (app/live/record.py), started from the top bar or with `make live`."""

    running: bool
    """Started from here and still going: recording, or waiting for `upcoming`."""
    since: datetime | None
    signed_in: bool
    """Signed in to F1 TV (FastF1's login); without it the feed has no data."""
    current: ScheduledSession | None
    """The session to record now: from an hour before its start until its end."""
    upcoming: ScheduledSession | None
    """The next session after that."""
    log: list[str]
    """The last lines of the recorder's output."""
