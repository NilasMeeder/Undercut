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


class LapPrediction(BaseModel):
    """What the lap a driver is on at t is on course for: his best lap until t plus the delta so
    far. Only push laps: not on an out-lap, not in the first 300 m, not 1 s or more down."""

    driver: str
    lap: int
    distance: float
    """Metres into the lap."""
    fraction: float
    """Share of the lap done (0–1)."""
    delta: float
    """Seconds behind his best lap at that point; positive = slower."""
    reference_lap: int
    reference_time: float
    predicted: float
    """Seconds: the best lap time plus the delta."""


class ComparedLap(BaseModel):
    """A lap resampled onto the comparison's shared distance grid."""

    driver: str
    lap: int
    lap_time: float | None
    length: float
    """Metres of telemetry over the lap."""
    length_off: float | None
    """Metres longer (+) or shorter (-) than a normal lap of this session when that is more than
    0.5% (a gap in the data, or the pit lane): stretched onto another lap, its corners land in
    the wrong place. Null when it is a normal length."""
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


class LiveCorner(BaseModel):
    """A corner segment of the reference lap, and the lap in progress through it once done."""

    label: str
    start: float
    end: float
    reference: CornerLap
    current: CornerLap | None
    """Null until the car is past the segment's end."""


class CornersProgress(BaseModel):
    """Corners for the lap a driver is on at t, against his previous or best lap: each corner
    filled in once the car is through it."""

    driver: str
    lap: int
    start: float
    """Session time (s) the lap started."""
    out_lap: bool
    progress: float
    """Metres into the lap, on the reference's scale."""
    reference_lap: int | None
    reference_time: float | None
    corners: list[LiveCorner]
    """Empty without a reference lap or corner data."""


class Comparison(BaseModel):
    distance: list[float]
    """Shared grid (m), stretched to the reference lap's length."""
    laps: list[ComparedLap]
    mini_sectors: MiniSectors
    corners: list[CornerSegment]
    """Empty when the circuit has no corner data."""


class ClipStretch(BaseModel):
    start: float
    end: float


class Downshift(BaseModel):
    """A downshift at full throttle on a straight, faster than 200 km/h: keeps the engine at or
    above 10,500 rpm (full fuel flow in 2026) while the car loses speed and harvests."""

    at: float
    """Distance (m) where the gear channel shows it (it lags the rpm by ~0.2 s)."""
    gear: int
    """Gear after the shift."""
    speed: float


class EnergyStraightLap(BaseModel):
    """One lap on one straight. Distances (m) on the reference lap's scale, like /compare;
    negative = before the line (the main straight runs on from the previous lap)."""

    start: float
    """Full throttle from here."""
    end: float
    """Full throttle up to here: the lift or the brake."""
    coast: float
    """Metres from the lift to the brake when that is 60 m or more (lift and coast), else 0."""
    entry_speed: float
    peak_speed: float
    end_speed: float
    """km/h at `end`."""
    clip_at: float | None
    """Where the car itself stops gaining speed at full throttle, when that is the battery: the
    best laps on this straight still gained there, or it goes on to lose speed (estimate); null
    if it does not clip."""
    clipping: list[ClipStretch]
    """Every stretch like that (it can gain again in between)."""
    deploying: list[ClipStretch]
    """Where it gains more than the engine alone could (estimate): the MGU-K is deploying."""
    superclip: ClipStretch | None
    """Where it loses speed at full throttle after the clip point (superclipping: harvesting while
    flat; in one gear the rpm falls with it); null if it does not."""
    lost: float
    """km/h lost at full throttle when it superclips: its highest speed after the clip point less
    the speed at `end`. 0 if it does not."""
    clipped: float
    """Metres of clipping, all stretches together."""
    cost_speed: float
    """km/h more at `end` had it kept accelerating like the best laps from clip_at."""
    cost_time: float
    """Seconds that would have saved up to `end`."""
    downshifts: list[Downshift]


class EnergyStraightStats(BaseModel):
    """A straight over a set of clean laps: shares and medians."""

    laps: int
    clipping: float
    """Share of the laps that clip (0–1)."""
    clipped: float
    """Median metres of clipping."""
    cost_time: float
    """Median seconds clipping cost."""
    peak_speed: float
    """Median top speed (km/h)."""
    downshifts: float
    """Share of the laps with a downshift at full throttle (0–1)."""
    superclipping: float
    """Share of the laps that lose speed at full throttle (0–1)."""
    lost: float
    """Median km/h lost at full throttle (0 for a lap that does not)."""


class EnergyStraight(BaseModel):
    corner: str
    """The corner it brakes for (a label of Circuit.corners)."""
    after: str
    """The corner it starts from (most laps)."""
    end: float
    """Median end of full throttle (m)."""
    session: EnergyStraightStats
    """Over every clean lap of the session."""


class EnergyLap(BaseModel):
    driver: str
    lap: int
    clipped: float
    """Metres of clipping on all straights."""
    cost_time: float
    """Seconds clipping cost on all straights."""
    straights: list[EnergyStraightLap | None]
    """Same order as EnergyComparison.straights; null if the lap has no run there (a lift)."""
    deploy: list[float | None] | None
    """With `step`: on /compare's distance grid, the acceleration at full throttle as % of the
    best laps on that straight at that speed (100 = as hard, 0 = not gaining, negative = losing
    speed: harvesting). Null off full throttle, in fast corners and near top speed."""
    deploying: list[bool] | None
    """With `step`: per point of `deploy` whether it deploys, the same estimate as
    EnergyStraightLap.deploying (more than the engine alone could)."""


class EnergyComparison(BaseModel):
    """Estimated energy deployment (2026): where laps stop gaining speed at full throttle."""

    straights: list[EnergyStraight]
    laps: list[EnergyLap]
    """Same order as asked; the first is the reference for the distance scale."""
    clean_laps: int
    """Clean laps of the session the estimate is built from."""


class DriverEnergy(BaseModel):
    driver: str
    laps: int
    """Clean laps."""
    cost_time: float
    """Median per lap of what clipping cost on all straights (s)."""
    straights: list[EnergyStraightStats | None]
    """Same order as EnergySession.straights."""


class EnergySession(BaseModel):
    straights: list[EnergyStraight]
    drivers: list[DriverEnergy]
    """Least clipping cost first."""
    clean_laps: int


class TrackZone(BaseModel):
    """A stretch to mark along the track. Distances in metres from the line on a lap of the
    session's usual length; a start below zero runs on from the previous lap."""

    label: str
    """'DRS 1', or 'T11 → T1' for a straight (from the corner it starts at to the one it brakes
    for, as in Energy)."""
    corner: str | None = None
    """A straight: the corner it brakes for (as in /energy)."""
    start: float
    end: float
    clip_at: float | None = None
    """A straight: where most clean laps start to clip (median), when most of them do."""
    clipping: float = 0.0
    """A straight: share of the clean laps that clip on it (0–1)."""


class TrackZones(BaseModel):
    kind: Literal["drs", "straight", "none"]
    """DRS zones until 2025; from 2026 (no DRS) the straights at full throttle (an estimate:
    the official straight-mode zones are not in the data)."""
    source: str | None = None
    """The session the zones come from (a race takes its DRS zones from qualifying)."""
    zones: list[TrackZone]


class StraightModeZone(BaseModel):
    """Where straight mode (2026, both wings flat) may be used. Distances in metres from the line
    on a lap of the session's usual length; a start below zero runs on from the previous lap."""

    label: str
    """'A1', 'A2'… as on the FIA's circuit map."""
    start: float
    """The FIA's activation point (a corner's position plus the metres after it: ±50 m)."""
    end: float
    end_source: Literal["braking", "next_zone", "drawing", "next_corner"]
    """The FIA's table gives no end: where most clean laps brake (the straight in Energy), where
    the next zone starts, read off the FIA's drawing by hand (before a flat-out corner, Spa's Eau
    Rouge), or without a straight in the data 150 m before the next corner."""
    activation: str
    """As the FIA writes it: '30m after T11 / Pit Exit'."""
    low_grip_start: float | None
    """In low-grip conditions (only the front wing): a later start, or null for no zone."""
    low_grip_activation: str | None


class TimeRange(BaseModel):
    start: float
    """Session time (s)."""
    end: float | None
    """Session time (s); null while it lasts."""


class OvertakePoints(BaseModel):
    """Overtake mode (2026, races): within 1 s of the car ahead at the detection line, a car gets
    extra MGU-K energy to use from the activation line. Metres from the line, like the zones
    (a corner's position plus the metres: ±50 m)."""

    detection: float
    activation: float
    detection_text: str
    """As the FIA writes it: 'Entry T11'."""
    activation_text: str


class OvertakeCheck(BaseModel):
    """One car crossing the overtake detection line (estimated from the position track)."""

    driver: str
    lap: int
    """The lap the car is on."""
    time: float
    """Session time (s)."""
    ahead: str | None
    """The car that crossed the line last before it (also a lapped car)."""
    gap: float | None
    """Seconds behind that car."""
    enabled: bool
    """Race control had overtake mode enabled."""
    within: bool
    """Within 1 s: with `enabled`, overtake mode until the next detection line."""


class OvertakeChecks(BaseModel):
    """Every passage of the overtake detection line in a race (2026); empty without one."""

    detection: float | None
    """Metres from the line, as in StraightMode.overtake."""
    checks: list[OvertakeCheck]


class Pass(BaseModel):
    """A car passing another for position on track (estimated from the position track)."""

    time: float
    """Session time (s) the order changed."""
    lap: int
    """The passer's lap."""
    driver: str
    """The car that got ahead."""
    passed: str
    distance: float
    """Metres from the line on the position track's lap."""
    fraction: float
    """The same as a share of the lap (0…1), for the map."""
    corner: str | None
    """The corner it went into: 'T4'."""
    position: int
    """The passer's position after it (by progress on track)."""
    overtake_mode: bool | None
    """2026: the passer had overtake mode then; null without overtake lines."""


class StraightMode(BaseModel):
    """Straight-mode zones of the event (2026) from the FIA's circuit map; empty without one."""

    source: str | None
    """URL of the FIA's circuit map."""
    length: float
    """The lap length the distances are on (the session's usual lap; the map's differs)."""
    zones: list[StraightModeZone]
    low_grip: list[TimeRange]
    """When race control declared low-grip conditions: the low-grip zones apply then."""
    overtake: OvertakePoints | None
    overtake_enabled: list[TimeRange]
    """When race control had overtake mode enabled (OVERTAKE ENABLED until DISABLED)."""


IncidentStatus = Literal[
    "noted", "investigating", "after", "no_investigation", "no_action", "penalty", "reprimand"
]
PenaltyKind = Literal["time", "drive_through", "stop_go", "reprimand", "grid", "disqualified"]


class DeletedLap(BaseModel):
    """A lap time deleted by race control (track limits, a double yellow)."""

    driver: str
    time: float | None
    """Session time (s) of the message."""
    lap: int | None
    lap_time: str | None
    """As race control writes it: '1:37.326'."""
    turn: str | None
    """'TURN 4', 'PIT ENTRY'."""
    track_limits: bool
    """A track-limits strike (3 in a race give the black-and-white flag, the next a penalty)."""
    reason: str


class BlackAndWhiteFlag(BaseModel):
    driver: str
    time: float | None
    reason: str


class IncidentEvent(BaseModel):
    time: float | None
    status: IncidentStatus
    text: str
    """The message without its prefix ('FIA STEWARDS:') and time stamp."""
    driver: str | None
    """For a decision: the car it is for."""


class Incident(BaseModel):
    """One incident from NOTED to the stewards' decision."""

    drivers: list[str]
    place: str
    """'TURN 4', 'PIT LANE', 'Q1', or empty."""
    reason: str
    """'CAUSING A COLLISION'; empty until race control gives one."""
    status: IncidentStatus
    """The last status (at the end of the session; the events say when it changed)."""
    events: list[IncidentEvent]


class Penalty(BaseModel):
    driver: str
    time: float | None
    kind: PenaltyKind
    seconds: int | None
    """Time penalty or stop-go seconds."""
    places: int | None
    """Grid penalty places."""
    reason: str
    text: str
    """'5 SECOND TIME PENALTY'."""
    served: float | None
    """Session time (s) race control said it was served."""


class Stewarding(BaseModel):
    """What race control said about deleted laps, flags, incidents and penalties."""

    deleted: list[DeletedLap]
    black_and_white: list[BlackAndWhiteFlag]
    incidents: list[Incident]
    penalties: list[Penalty]


class EvolutionLap(BaseModel):
    """A push lap in the track-evolution fit."""

    driver: str
    lap: int
    time: float
    """Session time (s) halfway round the lap."""
    gain: float
    """What this lap says about the track: seconds quicker than at the first push lap, after
    the driver's level and the tyre (the curve plus this lap's own noise)."""


class EvolutionDriver(BaseModel):
    """A driver's best push lap, and what it was worth on the track of the end."""

    driver: str
    lap: int
    lap_time: float
    time: float
    """Session time (s) halfway round the lap."""
    gain: float
    """The track's gain (s) at that moment."""
    worth: float
    """The lap time on the track of the end: lap_time minus what the track gained after it."""


class TrackEvolution(BaseModel):
    """Qualifying: how much quicker the track got, per driver corrected for his level and the
    tyre (an estimate; anything that makes everyone quicker over time counts)."""

    times: list[float]
    """Session time (s), every 30 s from the first push lap to the last."""
    gain: list[float]
    """Seconds quicker than at the first push lap."""
    total: float
    """Gain (s) from the first push lap to the last."""
    recent: float
    """Gain (s) over the last `recent_minutes`."""
    recent_minutes: int
    spread: float
    """Robust standard deviation (s) of a push lap around the fit."""
    points: list[EvolutionLap]
    drivers: list[EvolutionDriver]
    """Ordered by `worth`."""


class TrackSectors(BaseModel):
    """Where the timing sectors end along the lap, for the map."""

    boundaries: list[float]
    """Metres from the line where sector 1 and sector 2 end, on the circuit's lap length (the
    scale of Circuit.track_distance). Empty without sector times or telemetry."""


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


class PitStopTime(BaseModel):
    """How long a car stood in its pit box (app/pitstops.py)."""

    driver: str
    lap: int
    """The in-lap."""
    t: float
    """Session time (s) of pit entry."""
    lane: float
    """Seconds from pit entry to exit."""
    stationary: float | None
    """Seconds stood still; null for a drive-through, or without data."""
    source: Literal["f1", "telemetry"] | None
    """F1's own time (PitStopSeries, live and F1-archive sessions) or measured in the telemetry
    (a tenth or two out either way)."""
    status: TrackStatus
    """Track status at pit entry."""


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


class ForecastPass(BaseModel):
    driver: str
    """The car it gets ahead of and stays ahead of to the flag."""
    lap: int


class ForecastRow(BaseModel):
    """One car's predicted finish: its pace now (stint fit, degradation, fuel) to the flag, with
    the stop it still owes."""

    driver: str
    position: int
    """Predicted finishing position."""
    now: int
    """Position at the cutoff."""
    gap: float | None
    """Predicted seconds behind the winner at the flag; null for a lapped car (see laps_down)."""
    laps_down: int
    stop_lap: int | None
    """The in-lap assumed for the stop it still owes (dry race, one compound so far): halfway to
    the flag. Null when none is owed."""
    stop_compound: str | None
    passes: list[ForecastPass]
    """Cars ahead now that it is predicted to pass, with the lap the gap goes through zero."""


class PitNowRow(BaseModel):
    """One car stopping now (at the cutoff) under the given track status, nobody else stopping."""

    driver: str
    position: int
    compound: str | None
    life: int | None
    owes_stop: bool
    """Has run one dry compound only: the stop has to come anyway."""
    in_pit: bool
    """Its last lap was an in-lap: stopping now."""
    rejoin: Rejoin | None
    """Null when the car has no gap yet (or is in the pit lane)."""
    places: int | None
    """Places lost by stopping now (rejoin − position)."""


class PitCalculator(BaseModel):
    """Who should stop under a safety car: every car's rejoin if it stops now."""

    lap: int
    status: TrackStatus
    """The status the pit loss is for (sc or vsc)."""
    loss: float
    green_loss: float
    """The pit loss under green: loss − this is what a stop now saves."""
    rows: list[PitNowRow]


class Forecast(BaseModel):
    """The predicted result of a race from the pace at the cutoff."""

    lap: int
    """The leader's lap at the cutoff."""
    total_laps: int
    pit_loss: float
    rows: list[ForecastRow]
    """In predicted order; cars without a pace (too few laps) at their place now."""
    notes: list[str]


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


class ChampionshipEntry(BaseModel):
    name: str
    """Driver code, or team name."""
    team: str
    points: float
    wins: int


class Championship(BaseModel):
    """The standings before this race or sprint, for the championship as it stands: add the points
    of the order at the clock (`points[position - 1]`)."""

    before: str
    """What the standings include, e.g. 'round 15 and the sprint'."""
    points: list[int]
    """Points for P1, P2, ... in this session."""
    fastest_lap_point: bool
    """One more point for the fastest lap, if in the points (races 2019-2024)."""
    drivers: list[ChampionshipEntry]
    teams: list[ChampionshipEntry]


class ArchiveDownload(BaseModel):
    """Downloading a session from F1's own archive with the F1 TV sign-in (sources/f1archive.py):
    for a session TracingInsights does not have and that was not recorded."""

    state: Literal["idle", "downloading", "converting", "ready", "error"]
    progress: float
    """0 to 1."""
    phase: str | None
    error: str | None
    offered: bool
    """The session is over and not recorded: downloading it makes sense."""
    signed_in: bool


class RecordingHealth(BaseModel):
    """How the recording of the session on now is doing (whoever records it)."""

    session: str
    last_write: datetime
    """When the recording last grew. F1 sends heartbeats, so even a quiet feed grows."""
    feed_utc: datetime | None
    """The newest time stamp F1 put in it: `last_write` minus this is how far the feed lags."""
    size: int
    """Bytes."""
    reconnects: int
    """Times the recorder reconnected since it started on this session (from its log)."""
    error: str | None
    """Converting the recording failed (the backend keeps trying)."""


class RecorderStatus(BaseModel):
    """The live recorder (app/live/record.py), started from the top bar or with `make live`."""

    running: bool
    """Started from here and still going: recording, or waiting for `upcoming`."""
    mode: Literal["now", "wait", "always"] | None
    """How it was started: the session on now, that or the next, or every session."""
    automatic: bool
    """Set to record every session: the backend starts the recorder again when it is not running
    (after a restart of the Mac), until it is stopped from the top bar."""
    since: datetime | None
    signed_in: bool
    """Signed in to F1 TV (FastF1's login); without it the feed has no data."""
    sign_in_expires: datetime | None
    """When the F1 TV sign-in runs out (then sign in again)."""
    current: ScheduledSession | None
    """The session to record now: from an hour before its start until its end."""
    upcoming: ScheduledSession | None
    """The next session after that."""
    log: list[str]
    """The last lines of the recorder's output."""
    health: RecordingHealth | None
    """The recording of `current`, once there is one."""


class ReportAction(BaseModel):
    """What a click on a line of the report opens."""

    laps: list[str]
    """DRV:lap to compare in the panel's link group, the first is the reference; empty = keep."""
    zoom: list[float] | None
    """[start, end] (m, on the first lap's scale) to zoom the group to."""
    t: float | None
    """Session time (s) to put the clock at."""


class ReportCorner(BaseModel):
    """Where a driver's best lap loses most to the fastest lap of the session."""

    driver: str
    lap: int
    reference: str
    reference_lap: int
    gap: float
    """Lap time behind the reference (s)."""
    corner: str
    """Corner segment label (as in /compare)."""
    loss: float
    """Seconds lost in that segment."""
    reference_stats: CornerLap
    stats: CornerLap
    action: ReportAction


class ReportRun(BaseModel):
    """A long run in practice: at least 5 laps at pace on one set."""

    driver: str
    stint: int
    compound: str | None
    laps: int
    median: float
    """Median lap time (s) of the run, not corrected for fuel (unknown in practice)."""
    best: float
    slope: float | None
    """Seconds per lap the run got slower (fuel burn and tyres together); null under 5 laps."""
    step_lap: int | None
    """Where the run's pace stepped (see LongRun)."""
    step: float | None
    action: ReportAction


class ReportStint(BaseModel):
    """A stint whose degradation stands out (fuel-corrected fit)."""

    driver: str
    stint: int
    compound: str | None
    slope: float
    laps: int
    start_lap: int
    end_lap: int
    action: ReportAction


class ReportClipping(BaseModel):
    """2026: a driver who loses most to clipping, against the one who loses least."""

    driver: str
    cost_time: float
    """Median per clean lap (s), all straights."""
    reference: str
    reference_cost: float
    corner: str
    after: str
    """The straight where the difference is biggest (it brakes for `corner`)."""
    straight_cost: float
    """Median cost on that straight (s) for `driver`."""
    action: ReportAction


ReportMomentKind = Literal["fast_stop", "slow_stop", "start", "undercut", "flag", "pace"]


class ReportMoment(BaseModel):
    """Something that happened in a race (or a long run in practice), at a moment on the clock."""

    kind: ReportMomentKind
    t: float
    lap: int | None
    driver: str | None
    other: str | None
    """The other car (undercut: the one that was passed; pace: the car it caught or got free of)."""
    value: float | None
    """Pit lane seconds (stops), places gained or lost (start), s/lap against the field (pace,
    negative = quicker; practice: against the run's own trend)."""
    status: TrackStatus | None
    """Flags: sc, vsc or red."""
    until_lap: int | None
    action: ReportAction
    known: float | None = None
    """Session time (s) from which the data shows it, if later than t (pace: the line after the
    fifth lap at the new pace; in a practice run the fourth)."""


class SessionReport(BaseModel):
    """Things worth looking at in a session, each with the comparison that shows it."""

    kind: Literal["race", "quali", "practice"]
    corners: list[ReportCorner]
    """Best laps against the fastest, where most time goes; quickest drivers first."""
    long_runs: list[ReportRun]
    """Practice only; quickest median first per compound."""
    compounds: list[CompoundPace]
    stints: list[ReportStint]
    """Most degradation first, then the least."""
    clipping: list[ReportClipping]
    """2026 on; most cost first."""
    moments: list[ReportMoment]
    """In time order. Races; in practice the long runs whose pace steps (kind pace)."""


class TyreUse(BaseModel):
    session: str
    laps: int
    first: int
    """Tyre age (laps) at the first lap of this stint."""
    last: int


class TyreSet(BaseModel):
    """One set of tyres as far as the data shows (it has no set numbers: chained by age)."""

    compound: str
    new_in: str | None
    """Session it was first used in new; null when it was already used before the data starts."""
    life: int
    """Age in laps at its last lap."""
    laps: int
    """Laps on it in the data."""
    last_session: str
    uses: list[TyreUse]


class DriverTyres(BaseModel):
    driver: str
    sets: list[TyreSet]
    """In the order they were first used."""


class TyreWeekend(BaseModel):
    """Every driver's tyre sets over the weekend up to and including this session."""

    sessions: list[str]
    missing: list[str]
    """Sessions of the weekend so far without data."""
    drivers: list[DriverTyres]


class SetupDriver(BaseModel):
    """One driver's best lap: how fast on the straights against how fast through the corners."""

    driver: str
    lap: int
    lap_time: float
    top_speed: float
    """km/h, highest on the lap."""
    speed_trap: float | None
    corner_speed: float | None
    """km/h, mean minimum speed over all corners."""
    slow_corners: float | None
    """km/h, mean minimum speed in the slow corners (below slow_limit on the quickest lap)."""
    fast_corners: float | None


class SetupMap(BaseModel):
    """Top speed against cornering speed per driver (best laps): low drag or high downforce."""

    slow_limit: float
    drivers: list[SetupDriver]
    """Quickest first; laps with a gap in their telemetry are left out."""


class TeammateCorner(BaseModel):
    label: str
    start: float
    gap: float
    """Seconds the second driver's best lap loses here to the first's (negative = gains)."""


class TeammatePair(BaseModel):
    """One team's drivers, the one with the quicker best lap first."""

    team: str
    drivers: list[str]
    laps: list[int | None]
    """Their best laps."""
    best: list[float | None]
    gap: float | None
    """Seconds the second is behind on best lap."""
    sectors: list[float | None]
    """Per sector of the best laps: second minus first."""
    top_speed: float | None
    """km/h, second minus first, highest on the best laps."""
    corners: list[TeammateCorner]
    """Empty when a lap has no usable telemetry."""
    pace: list[float | None]
    """Race: median of the clean laps."""
    pace_laps: list[int]


class Teammates(BaseModel):
    race: bool
    teams: list[TeammatePair]


class WeekendSession(BaseModel):
    code: str
    race: bool


class WeekendCell(BaseModel):
    position: int
    """Race: at the finish; otherwise by best lap."""
    best: float | None
    gap: float | None
    """Best lap to the session's quickest."""


class LongRun(BaseModel):
    """A long run in practice: at least 5 laps at pace on one set (a race simulation)."""

    session: str
    """The practice session it was driven in (FP1–FP3)."""
    driver: str
    stint: int
    compound: str | None
    used: int | None
    """Laps already on the set when the stint began (0 = a new set)."""
    start_lap: int
    end_lap: int
    """First and last lap at pace."""
    start: float | None
    """Session time (s) the first lap at pace began."""
    laps: int
    """Laps at pace (clean, within 107% of the driver's best)."""
    median: float
    best: float
    slope: float | None
    """Seconds per lap the run got slower, raw: tyres and fuel burn together."""
    deg: float | None
    """The slope with the fuel burn put back (PRACTICE_BURN kg per lap × the fuel effect): the
    tyres alone, if the car burnt that much. Null under 5 laps."""
    gap: float
    """Median against the quickest median on the same compound (s)."""
    times: list[float | None]
    """Lap times from start_lap to end_lap; null for a lap not at pace (traffic, a cool lap)."""
    typical: int
    """The lap nearest the median, to compare."""
    open: bool
    """The set is still on the car at the cutoff (no in-lap yet): the run may go on."""
    step_lap: int | None
    """The run's pace stepped from this lap on (see pace.py: against the run's own trend, so
    not the tyres wearing or the fuel burning off gradually); null if it did not."""
    step: float | None
    """Seconds a lap of that step (medians of the laps either side, negative = quicker)."""


class LongRuns(BaseModel):
    runs: list[LongRun]
    """Per compound, quickest median first."""
    fuel_per_lap: float
    """Seconds a lap gets quicker from the fuel burnt on the lap before (assumed)."""


class StartCar(BaseModel):
    """One car off the line: where it stood, when it passed each checkpoint, how it launched."""

    driver: str
    grid: int | None
    """Grid position (Jolpica; at a restart the order on the grid); null when unknown."""
    slot: float | None
    """Metres behind the pole sitter's grid slot, from the car's position before it moved
    (about 8 m a place); null for a pit-lane start."""
    pit_lane: bool
    """Started from the pit lane (moved off well after the field)."""
    times: list[float | None]
    """Seconds after lights out at each checkpoint of Starts.checkpoints; null if not reached."""
    positions: list[int | None]
    """Place at each checkpoint, by the order the cars passed it."""
    speed: float | None
    """Top speed (km/h) up to the last checkpoint."""
    moved: bool
    """The car's telemetry shows it moving off (false: did not start, or no car data)."""
    to_100: float | None
    to_200: float | None
    """Seconds after lights out to 100 and 200 km/h (±0.25 s: telemetry is ~4 Hz)."""
    lap_1: int | None
    """Place at the end of lap 1 (a restart: of Starts.lap)."""
    lap_1_end: float | None
    """Session time (s) the car completed that lap."""


class Starts(BaseModel):
    """The race start (lights out, lap 1) from each car's first-lap telemetry, or a standing
    restart after a red flag."""

    lights_out: float
    """Session time (s) of the start (a restart: where the field moved off together, less the
    reaction at the race start)."""
    lap: int
    """The lap whose end StartCar.lap_1 is: 1 at the race start, else the first lap after it."""
    restart: bool
    """A standing restart after a red flag; its grid is the order the cars stood in."""
    checkpoints: list[float]
    """Metres past the pole sitter's grid slot."""
    cars: list[StartCar]
    """In the order at the last checkpoint; cars that did not get there last."""


class TeamRadio(BaseModel):
    """A team radio clip; the audio is at /team-radio/{id}."""

    id: int
    driver: str
    utc: datetime
    t: float | None
    """Session time (s); null while the session has no lap timing yet."""
    text: str | None = None
    """What is said, once transcribed (app/transcribe.py); '' when nothing was understood."""


class Transcription(BaseModel):
    """Transcribing a session's team radio on this computer (Whisper)."""

    engine: Literal["mlx", "faster-whisper"] | None
    """None: not set up (in backend/: uv sync --group transcribe)."""
    model: str | None
    state: Literal["idle", "running", "done", "error"]
    done: int
    total: int
    error: str | None


class QualiDuel(BaseModel):
    """Two teammates in one qualifying: their best laps in the last part both set a time in."""

    round: int
    segment: str | None
    """Q1, Q2 or Q3 (null for a session without parts)."""
    a: float | None
    b: float | None
    """Best lap (s) of SeasonPair.drivers[0] and [1]; null without a time."""
    a_lap: int | None
    b_lap: int | None
    gap: float | None
    """b − a (s): positive = the first driver was quicker."""
    pct: float | None
    """The gap as % of the quicker lap; null when it is over 3% (a problem, not pace)."""
    ahead: int | None
    """0 when the first driver was ahead (he got further, or was quicker in the same part, or
    was the only one with a time), 1 the second, null when neither set a time."""


class SeasonPair(BaseModel):
    team: str
    color: str
    drivers: list[str]
    """The two drivers, the one ahead more often first."""
    duels: list[QualiDuel | None]
    """Per round of SeasonQuali.rounds; null when the two were not teammates there."""
    ahead: list[int]
    """Rounds each was quicker (head to head)."""
    median_gap: float | None
    median_pct: float | None
    """Over the rounds both set a time; positive = the first driver quicker."""


class SeasonRound(BaseModel):
    round: int
    name: str


class SeasonQuali(BaseModel):
    """Teammates in qualifying over the season up to this round."""

    year: int
    session: str
    """Q or SQ."""
    rounds: list[SeasonRound]
    pairs: list[SeasonPair]


class WeekendLongRun(BaseModel):
    """A driver's longest run in practice (the race simulation; median lap, no fuel correction)."""

    session: str
    compound: str | None
    laps: int
    median: float


class WeekendDriver(BaseModel):
    driver: str
    cells: list[WeekendCell | None]
    """Per session of WeekendOverview.sessions; null when he did not drive it."""
    long_run: WeekendLongRun | None
    race_pace: float | None
    """Median of the clean race laps."""


class WeekendOverview(BaseModel):
    """Every driver from the first practice to this session, in the order of the latest one."""

    sessions: list[WeekendSession]
    drivers: list[WeekendDriver]
