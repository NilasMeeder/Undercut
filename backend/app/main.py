import asyncio
import gzip
import json
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import StreamingResponse

from app import (
    analysis,
    energies,
    evolution,
    longruns,
    overtake,
    passes,
    progress,
    radio,
    replays,
    reports,
    schedule,
    season,
    sessions,
    setups,
    starts,
    stewards,
    store,
    straight_mode,
    strategies,
    strategy,
    tyres,
    weekend,
    zones,
)
from app.live import record, recorder
from app.live import service as live
from app.local_only import LocalOnly
from app.schemas import (
    Circuit,
    ComparedLap,
    Comparison,
    CornerLap,
    CornerSegment,
    CornersProgress,
    Degradation,
    EnergyComparison,
    EnergySession,
    Forecast,
    Lap,
    LapPrediction,
    LapProgress,
    LiveCorner,
    LiveSessionInfo,
    LongRuns,
    Marker,
    MarkerIn,
    MiniSectors,
    OvertakeChecks,
    Pass,
    PitCalculator,
    PitWindow,
    ProgressReference,
    RaceControlMessage,
    RaceHistory,
    RecorderStatus,
    ReplayPositions,
    ReplayStatus,
    ScheduledSession,
    SeasonEvents,
    SeasonQuali,
    SessionCode,
    SessionDetail,
    SessionReport,
    SessionTimeline,
    SetupMap,
    Starts,
    Stewarding,
    StraightMode,
    TagCount,
    Teammates,
    TeamRadio,
    Telemetry,
    TimingState,
    TrackEvolution,
    TrackSectors,
    TrackZones,
    TyreWeekend,
    View,
    ViewIn,
    Weather,
    WeekendOverview,
)
from app.sources.tracinginsights import SourceNotAvailable

FIRST_SEASON = 2018
"""First season with full telemetry."""

MAX_COMPARED_LAPS = 8


@asynccontextmanager
async def lifespan(_: FastAPI):
    schedule.init_cache()
    live.service.start()
    yield
    live.service.stop()


app = FastAPI(title="F1 Pitwall API", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(LocalOnly)


def _guard[T](load: Callable[[], T]) -> T:
    """Translate data-layer errors into HTTP errors."""
    try:
        return load()
    except (KeyError, SourceNotAvailable, LookupError) as error:  # incl. store.NotFound
        raise HTTPException(404, str(error).strip("'\"")) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


def _rounded(values: np.ndarray, decimals: int) -> list[float]:
    return np.round(values, decimals).tolist()


# Route handlers take a `round` parameter (the race round), which shadows the builtin there.
def _one_decimal(value: float) -> float:
    return round(value, 1)


def _maybe_one_decimal(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


def _nullable(values: np.ndarray, decimals: int) -> list[float | None]:
    """Rounded, NaN as null."""
    return [None if np.isnan(v) else float(v) for v in np.round(values, decimals)]


def _nullable_ints(values: np.ndarray) -> list[int | None]:
    return [None if np.isnan(v) else int(v) for v in values]


def _ints(values: np.ndarray) -> list[int]:
    return values.astype(int).tolist()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/seasons/{year}/events")
def season_events(year: int) -> SeasonEvents:
    if not FIRST_SEASON <= year <= date.today().year:
        raise HTTPException(404, f"Season {year} not supported (from {FIRST_SEASON})")
    return schedule.get_season_events(year)


@app.get("/api/sessions/{year}/{round}/{session}")
def session_detail(year: int, round: int, session: SessionCode) -> SessionDetail:
    return _guard(lambda: sessions.get_detail(year, round, session))


@app.get("/api/sessions/{year}/{round}/{session}/laps")
def session_laps(year: int, round: int, session: SessionCode) -> list[Lap]:
    return _guard(lambda: sessions.get_laps(year, round, session))


@app.get("/api/sessions/{year}/{round}/{session}/circuit")
def session_circuit(year: int, round: int, session: SessionCode) -> Circuit:
    return _guard(lambda: sessions.get_circuit(year, round, session))


@app.get("/api/sessions/{year}/{round}/{session}/race-control")
def session_race_control(year: int, round: int, session: SessionCode) -> list[RaceControlMessage]:
    return _guard(lambda: sessions.get_race_control(year, round, session))


@app.get("/api/sessions/{year}/{round}/{session}/weather")
def session_weather(year: int, round: int, session: SessionCode) -> Weather:
    return _guard(lambda: sessions.get_weather(year, round, session))


@app.get("/api/sessions/{year}/{round}/{session}/timeline")
def session_timeline(year: int, round: int, session: SessionCode) -> SessionTimeline:
    return _guard(lambda: replays.get_timeline(year, round, session))


@app.get("/api/sessions/{year}/{round}/{session}/timing")
def session_timing(
    year: int,
    round: int,
    session: SessionCode,
    t: Annotated[float, Query(description="Session time (s)")],
) -> TimingState:
    return _guard(lambda: replays.timing_state(year, round, session, t))


@app.get("/api/sessions/{year}/{round}/{session}/positions/status")
def positions_status(year: int, round: int, session: SessionCode) -> ReplayStatus:
    return _guard(lambda: replays.status(year, round, session))


@app.post("/api/sessions/{year}/{round}/{session}/positions/prepare")
def positions_prepare(year: int, round: int, session: SessionCode) -> ReplayStatus:
    """Start downloading the telemetry and building the position track (once per session)."""
    return _guard(lambda: replays.prepare(year, round, session))


@app.get(
    "/api/sessions/{year}/{round}/{session}/positions",
    response_model=ReplayPositions,
    responses={409: {"description": "Not prepared yet: POST .../positions/prepare first"}},
)
def positions(year: int, round: int, session: SessionCode, request: Request) -> Response:
    if _guard(lambda: replays.status(year, round, session)).state != "ready":
        raise HTTPException(409, "The position track is not prepared yet")
    body = _guard(lambda: replays.positions_gzip(year, round, session))
    # Compressed once and cached; the GZip middleware leaves an encoded response alone.
    if "gzip" in request.headers.get("accept-encoding", ""):
        headers = {"Content-Encoding": "gzip", "Vary": "Accept-Encoding"}
        return Response(body, media_type="application/json", headers=headers)
    return Response(gzip.decompress(body), media_type="application/json")


Until = Annotated[
    float | None,
    Query(description="Session time (s): only laps completed by then count; omit for all"),
]
Fuel = Annotated[
    float,
    Query(ge=0, le=0.1, description="Fuel effect in s per kg (100 kg at the start of a race)"),
]


@app.get("/api/sessions/{year}/{round}/{session}/race-history")
def race_history(year: int, round: int, session: SessionCode) -> RaceHistory:
    return _guard(lambda: strategies.get_history(year, round, session))


@app.get("/api/sessions/{year}/{round}/{session}/degradation")
def degradation(
    year: int,
    round: int,
    session: SessionCode,
    until: Until = None,
    fuel: Fuel = strategy.FUEL_EFFECT,
) -> Degradation:
    return _guard(lambda: strategies.get_degradation(year, round, session, fuel, until))


@app.get("/api/sessions/{year}/{round}/{session}/pit-window")
def pit_window(
    year: int,
    round: int,
    session: SessionCode,
    driver: Annotated[str, Query(pattern=r"^[A-Z]{3}$")],
    until: Until = None,
    fuel: Fuel = strategy.FUEL_EFFECT,
    compound: Annotated[str | None, Query(pattern=r"^(SOFT|MEDIUM|HARD|INTERMEDIATE|WET)$")] = None,
) -> PitWindow:
    return _guard(
        lambda: strategies.get_pit_window(year, round, session, driver, fuel, until, compound)
    )


@app.get("/api/sessions/{year}/{round}/{session}/forecast")
def race_forecast(
    year: int,
    round: int,
    session: SessionCode,
    until: Until = None,
    fuel: Fuel = strategy.FUEL_EFFECT,
) -> Forecast:
    """The predicted result from the pace at the cutoff, with the stops still owed."""
    return _guard(lambda: strategies.get_forecast(year, round, session, fuel, until))


@app.get("/api/sessions/{year}/{round}/{session}/pit-calculator")
def pit_calculator(
    year: int,
    round: int,
    session: SessionCode,
    until: Until = None,
    status: Annotated[
        Literal["sc", "vsc", "green"], Query(description="Whose pit loss: safety car or VSC")
    ] = "sc",
) -> PitCalculator:
    """Every car's rejoin if it stops now under a safety car (or VSC), nobody else stopping."""
    return _guard(lambda: strategies.get_pit_calculator(year, round, session, until, status))


@app.get("/api/sessions/{year}/{round}/{session}/telemetry")
def lap_telemetry(
    year: int,
    round: int,
    session: SessionCode,
    driver: Annotated[str, Query(min_length=3, max_length=3)],
    lap: Annotated[str, Query(description="Lap number or 'fastest'")] = sessions.FASTEST,
) -> Telemetry:
    def load() -> Telemetry:
        [(code, ref)] = sessions.parse_lap_refs(f"{driver}:{lap}")
        number = sessions.resolve_lap(year, round, session, code, ref)
        trace = sessions.get_trace(year, round, session, code, number)
        ch = trace.channels
        return Telemetry(
            driver=code,
            lap=number,
            distance=_rounded(trace.distance, 1),
            time=_rounded(trace.time, 3),
            speed=_rounded(ch["speed"], 1),
            throttle=_rounded(ch["throttle"], 0),
            brake=_ints(ch["brake"]),
            gear=_ints(ch["gear"]),
            rpm=_rounded(ch["rpm"], 0),
            drs=_ints(ch["drs"]) if "drs" in ch else None,
            x=_rounded(ch["x"], 0),
            y=_rounded(ch["y"], 0),
        )

    return _guard(load)


@app.get("/api/sessions/{year}/{round}/{session}/lap-progress")
def lap_progress(
    year: int,
    round: int,
    session: SessionCode,
    driver: Annotated[str, Query(min_length=3, max_length=3)],
    t: Annotated[float, Query(description="Session time (s)")],
    reference: Annotated[
        progress.Reference, Query(description="previous lap, or the best lap until t")
    ] = "previous",
) -> LapProgress:
    def load() -> LapProgress:
        p = progress.lap_in_progress(year, round, session, driver.upper(), t, reference)
        grid = progress.on_grid(p.trace, p.reference_trace, p.length)
        lap = grid.current
        ref = None
        if p.reference is not None and grid.reference is not None:
            ref = ProgressReference(
                lap=p.reference.lap,
                lap_time=p.reference.lap_time,
                speed=_nullable(grid.reference["speed"], 1),
            )
        return LapProgress(
            driver=driver.upper(),
            lap=p.lap,
            start=float(np.round(p.start, 3)),
            elapsed=float(np.round(p.trace.time[-1], 3)),
            progress=float(np.round(grid.progress, 1)),
            out_lap=p.out_lap,
            distance=_rounded(grid.distance, 1),
            time=_nullable(lap["time"], 3),
            speed=_nullable(lap["speed"], 1),
            throttle=_nullable(lap["throttle"], 0),
            brake=_nullable_ints(lap["brake"]),
            gear=_nullable_ints(lap["gear"]),
            reference=ref,
            delta=_nullable(grid.delta, 3),
        )

    return _guard(load)


def _corner_lap(s: analysis.CornerStats) -> CornerLap:
    return CornerLap(
        time=float(np.round(s.time, 3)),
        brake_at=_maybe_one_decimal(s.brake_at),
        min_speed=_one_decimal(s.min_speed),
        min_speed_at=_one_decimal(s.min_speed_at),
        throttle_at=_maybe_one_decimal(s.throttle_at),
        top_speed=_one_decimal(s.top_speed),
    )


@app.get("/api/sessions/{year}/{round}/{session}/corners-progress")
def corners_progress(
    year: int,
    round: int,
    session: SessionCode,
    driver: Annotated[str, Query(min_length=3, max_length=3)],
    t: Annotated[float, Query(description="Session time (s)")],
    reference: Annotated[
        progress.Reference, Query(description="previous lap, or the best lap until t")
    ] = "previous",
) -> CornersProgress:
    """Corners for the lap the driver is on at t: each corner once the car is through it."""

    def load() -> CornersProgress:
        p = progress.lap_in_progress(year, round, session, driver.upper(), t, reference)
        try:
            circuit = sessions.get_circuit(year, round, session)
            corners = [(c.label, c.distance) for c in circuit.corners]
        except SourceNotAvailable:
            corners = []
        grid, live_corners = progress.corners_in_progress(p, corners)
        return CornersProgress(
            driver=driver.upper(),
            lap=p.lap,
            start=float(np.round(p.start, 3)),
            out_lap=p.out_lap,
            progress=float(np.round(grid.progress, 1)),
            reference_lap=p.reference.lap if p.reference is not None else None,
            reference_time=p.reference.lap_time if p.reference is not None else None,
            corners=[
                LiveCorner(
                    label=c.segment.label,
                    start=_one_decimal(c.segment.start),
                    end=_one_decimal(c.segment.end),
                    reference=_corner_lap(c.segment.laps[0]),
                    current=_corner_lap(c.current) if c.current is not None else None,
                )
                for c in live_corners
            ],
        )

    return _guard(load)


@app.get("/api/sessions/{year}/{round}/{session}/predictions")
def lap_predictions(
    year: int,
    round: int,
    session: SessionCode,
    t: Annotated[float, Query(description="Session time (s)")],
) -> list[LapPrediction]:
    """Per car on a push lap at t: the lap time it is on course for."""

    def load() -> list[LapPrediction]:
        drivers = sorted({lap.driver for lap in sessions.get_laps(year, round, session)})
        out = []
        for driver in drivers:
            p = progress.predict(year, round, session, driver, t)
            if p is not None:
                out.append(
                    LapPrediction(
                        driver=p.driver,
                        lap=p.lap,
                        distance=float(np.round(p.distance, 1)),
                        fraction=float(np.round(p.fraction, 4)),
                        delta=float(np.round(p.delta, 3)),
                        reference_lap=p.reference_lap,
                        reference_time=p.reference_time,
                        predicted=float(np.round(p.predicted, 3)),
                    )
                )
        return out

    return _guard(load)


@app.get("/api/sessions/{year}/{round}/{session}/tyre-sets")
def tyre_sets(year: int, round: int, session: SessionCode) -> TyreWeekend:
    """Every driver's tyre sets over the weekend up to and including this session."""
    return _guard(lambda: tyres.weekend(year, round, session))


@app.get("/api/sessions/{year}/{round}/{session}/setups")
def setup_map(year: int, round: int, session: SessionCode) -> SetupMap:
    """Top speed against cornering speed of every driver's best lap."""
    return _guard(lambda: setups.setup_map(year, round, session))


@app.get("/api/sessions/{year}/{round}/{session}/teammates")
def teammate_pairs(year: int, round: int, session: SessionCode) -> Teammates:
    """Each team's drivers side by side."""
    return _guard(lambda: setups.teammates(year, round, session))


@app.get("/api/sessions/{year}/{round}/{session}/weekend")
def weekend_overview(year: int, round: int, session: SessionCode) -> WeekendOverview:
    """Every driver from the first practice up to this session."""
    return _guard(lambda: weekend.overview(year, round, session))


@app.get("/api/sessions/{year}/{round}/{session}/long-runs")
def long_runs(
    year: int,
    round: int,
    session: SessionCode,
    until: Until = None,
    fuel: Fuel = strategy.FUEL_EFFECT,
    weekend: bool = False,
) -> LongRuns:
    """Long runs in practice (≥ 5 laps at pace on one set), per compound; with `weekend` also
    those of the practice sessions before this one."""
    return _guard(lambda: longruns.get_long_runs(year, round, session, until, fuel, weekend))


@app.get("/api/sessions/{year}/{round}/{session}/compare")
def compare_laps(
    year: int,
    round: int,
    session: SessionCode,
    laps: Annotated[
        str,
        Query(description="Comma-separated DRV:lap, e.g. VER:17,NOR:fastest; first = reference"),
    ],
    step: Annotated[float, Query(ge=1, le=50, description="Grid spacing in metres")] = 5.0,
    mini_sectors: Annotated[int, Query(ge=1, le=200)] = 25,
) -> Comparison:
    def load() -> Comparison:
        refs = sessions.parse_lap_refs(laps)
        if len(refs) > MAX_COMPARED_LAPS:
            raise ValueError(f"Compare at most {MAX_COMPARED_LAPS} laps")
        resolved = [
            (code, sessions.resolve_lap(year, round, session, code, ref)) for code, ref in refs
        ]
        traces = [sessions.get_trace(year, round, session, c, n) for c, n in resolved]
        result = analysis.compare(traces, step)
        sectors = analysis.mini_sectors(result, mini_sectors)
        try:
            circuit = sessions.get_circuit(year, round, session)
            corners = analysis.corner_segments(
                result, [(c.label, c.distance) for c in circuit.corners]
            )
        except SourceNotAvailable:
            corners = []

        typical = sessions.typical_lap_length(year, round, session)
        compared = []
        for (code, number), trace, lap, delta in zip(
            resolved, traces, result.laps, result.deltas, strict=True
        ):
            ch = lap.channels
            off = analysis.length_off(trace.length, typical)
            compared.append(
                ComparedLap(
                    driver=code,
                    lap=number,
                    lap_time=sessions.lap_time(year, round, session, code, number),
                    length=float(np.round(trace.length, 1)),
                    length_off=None if off is None else float(np.round(off, 1)),
                    time=_rounded(lap.time, 3),
                    delta=_rounded(delta, 3),
                    speed=_rounded(ch["speed"], 1),
                    throttle=_rounded(ch["throttle"], 0),
                    brake=_ints(ch["brake"]),
                    gear=_ints(ch["gear"]),
                    rpm=_rounded(ch["rpm"], 0),
                    drs=_ints(ch["drs"]) if "drs" in ch else None,
                    x=_rounded(ch["x"], 0),
                    y=_rounded(ch["y"], 0),
                )
            )
        return Comparison(
            distance=_rounded(result.distance, 1),
            laps=compared,
            mini_sectors=MiniSectors(
                boundaries=_rounded(sectors.boundaries, 1),
                times=[_rounded(t, 3) for t in sectors.times],
                fastest=sectors.fastest.tolist(),
            ),
            corners=[
                CornerSegment(
                    label=segment.label,
                    start=_one_decimal(segment.start),
                    end=_one_decimal(segment.end),
                    laps=[_corner_lap(s) for s in segment.laps],
                )
                for segment in corners
            ],
        )

    return _guard(load)


@app.get("/api/sessions/{year}/{round}/{session}/energy")
def energy_laps(
    year: int,
    round: int,
    session: SessionCode,
    laps: Annotated[
        str,
        Query(description="Comma-separated DRV:lap, e.g. VER:17,NOR:fastest; first = reference"),
    ],
    step: Annotated[
        float | None,
        Query(ge=1, le=50, description="Also deploy per lap, on /compare's grid for this step"),
    ] = None,
) -> EnergyComparison:
    """Where the laps stop gaining speed at full throttle (an estimate: there is no battery
    channel). The first request for a session reads the telemetry of all its clean laps."""

    def load() -> EnergyComparison:
        refs = sessions.parse_lap_refs(laps)
        if len(refs) > MAX_COMPARED_LAPS:
            raise ValueError(f"Compare at most {MAX_COMPARED_LAPS} laps")
        resolved = [
            (code, sessions.resolve_lap(year, round, session, code, ref)) for code, ref in refs
        ]
        return energies.compare(year, round, session, resolved, step)

    return _guard(load)


@app.get("/api/sessions/{year}/{round}/{session}/report")
def session_report(year: int, round: int, session: SessionCode) -> SessionReport:
    """Things worth looking at in the session, each with the comparison that shows it. The first
    request reads the best laps' telemetry (and in 2026 every clean lap, for clipping)."""
    return _guard(lambda: reports.get_report(year, round, session))


@app.get("/api/sessions/{year}/{round}/{session}/zones")
def track_zones(year: int, round: int, session: SessionCode) -> TrackZones:
    """DRS zones (until 2025) or the straights with where the session clips (2026), for the map."""
    return _guard(lambda: zones.get_zones(year, round, session))


@app.get("/api/sessions/{year}/{round}/{session}/straight-mode")
def straight_mode_zones(year: int, round: int, session: SessionCode) -> StraightMode:
    """Straight-mode zones (2026) from the FIA's circuit map, ended where the session brakes, and
    when race control declared low-grip conditions."""
    return _guard(lambda: straight_mode.get_straight_mode(year, round, session))


@app.get("/api/sessions/{year}/{round}/{session}/overtake")
def overtake_checks(year: int, round: int, session: SessionCode) -> OvertakeChecks:
    """Races (2026): every passage of the overtake detection line, with the gap to the car ahead
    and whether it gave overtake mode. Needs the position track (404 until it is prepared)."""
    return _guard(lambda: overtake.get_checks(year, round, session))


@app.get("/api/sessions/{year}/{round}/{session}/passes")
def on_track_passes(year: int, round: int, session: SessionCode) -> list[Pass]:
    """Races: every pass for position on track (from the position track: 404 until it is
    prepared), with where and, in 2026, whether the passer had overtake mode."""
    return _guard(lambda: passes.get_passes(year, round, session))


@app.get("/api/sessions/{year}/{round}/{session}/starts")
def race_start(year: int, round: int, session: SessionCode) -> list[Starts]:
    """Races: the start from each car's first-lap telemetry (grid slot, checkpoints 100–500 m
    past the pole slot, 0–100 and 0–200 km/h), then each standing restart after a red flag;
    404 until lap 1 has telemetry."""
    return _guard(lambda: starts.get_starts(year, round, session))


@app.get("/api/sessions/{year}/{round}/{session}/team-radio")
def team_radio(year: int, round: int, session: SessionCode) -> list[TeamRadio]:
    """The session's team radio clips in time order (none when the archive has none)."""
    return _guard(lambda: radio.get_team_radio(year, round, session))


@app.get(
    "/api/sessions/{year}/{round}/{session}/team-radio/{clip}",
    response_class=Response,
    responses={200: {"content": {"audio/mpeg": {}}}},
)
def team_radio_audio(year: int, round: int, session: SessionCode, clip: int) -> Response:
    """One clip's audio (mp3), fetched once and cached."""
    audio = _guard(lambda: radio.get_audio(year, round, session, clip))
    return Response(
        audio, media_type="audio/mpeg", headers={"Cache-Control": "max-age=86400, immutable"}
    )


@app.get("/api/sessions/{year}/{round}/{session}/season-quali")
def season_quali(
    year: int,
    round: int,
    session: SessionCode,
    kind: Annotated[str, Query(pattern=r"^(Q|SQ)$")] = "Q",
) -> SeasonQuali:
    """Teammates in qualifying (or sprint qualifying) over the season up to this round."""
    return _guard(lambda: season.season_quali(year, round, session, kind))


@app.get("/api/sessions/{year}/{round}/{session}/stewards")
def stewarding(year: int, round: int, session: SessionCode) -> Stewarding:
    """Deleted laps, black-and-white flags, incidents and penalties, read from race control."""
    return _guard(lambda: stewards.get_stewarding(year, round, session))


@app.get("/api/sessions/{year}/{round}/{session}/track-evolution")
def track_evolution(
    year: int, round: int, session: SessionCode, until: Until = None
) -> TrackEvolution:
    """Qualifying: how much quicker the track got over the session (per driver corrected for
    his level and the tyre), and what each best lap was worth on the track of the end."""
    return _guard(lambda: evolution.get_evolution(year, round, session, until))


@app.get("/api/sessions/{year}/{round}/{session}/sectors")
def track_sectors(year: int, round: int, session: SessionCode) -> TrackSectors:
    """Where sector 1 and 2 end along the lap, for the map."""
    return _guard(lambda: zones.get_sectors(year, round, session))


@app.get("/api/sessions/{year}/{round}/{session}/energy/session")
def energy_session(year: int, round: int, session: SessionCode) -> EnergySession:
    """Per driver and straight over the session's clean laps: who clips where, at what cost."""
    return _guard(lambda: energies.summary(year, round, session))


# Live: sessions recorded from the live timing feed (app/live), converted as they grow.

LIVE_TICK = 0.5
"""Seconds between two checks of a live session for new data (events/)."""


def _live_info(session: live.LiveSession) -> LiveSessionInfo:
    return LiveSessionInfo(
        year=session.year,
        round=session.round,
        code=session.code,  # type: ignore[arg-type]
        event_name=session.event,
        session_name=session.session,
        state="live" if session.is_active() else "recorded",
        horizon=None if session.horizon is None else round(session.horizon, 3),
        version=session.version,
        status=session.status,
        error=session.error,
    )


@app.get("/api/live")
def live_sessions() -> list[LiveSessionInfo]:
    """Recorded sessions, live ones first."""
    infos = [_live_info(s) for s in live.service.sessions.values()]
    return sorted(infos, key=lambda i: (i.state != "live", -i.year, -i.round))


def _scheduled(found: tuple[int, int, str, datetime] | None) -> ScheduledSession | None:
    if found is None:
        return None
    year, round_number, code, start = found
    event, info = schedule.resolve_session(year, round_number, code)
    return ScheduledSession(
        year=year,
        round=round_number,
        code=code,  # type: ignore[arg-type]
        event_name=event.name,
        session_name=info.name,
        start_utc=start,
    )


@app.get("/api/live/recorder")
def recorder_status() -> RecorderStatus:
    """Whether the recorder runs, and what it would record."""
    now = datetime.now(UTC)
    current = record.current_session(now)
    after = current[3] + timedelta(minutes=1) if current is not None else now
    state = recorder.running()
    return RecorderStatus(
        running=state is not None,
        since=datetime.fromisoformat(state["started"]) if state else None,
        signed_in=record.signed_in(),
        current=_scheduled(current),
        upcoming=_scheduled(record.upcoming_session(after)),
        log=recorder.log_tail(),
    )


@app.post("/api/live/recorder")
def recorder_start(wait: bool = False) -> RecorderStatus:
    """Start recording the session on now; `wait`: or wait for the next one. The recorder is its
    own process: it goes on when the backend restarts."""
    try:
        recorder.start(wait)
    except recorder.RecorderBusy as error:
        raise HTTPException(409, str(error)) from error
    except recorder.NotSignedIn as error:
        raise HTTPException(403, str(error)) from error
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    return recorder_status()


@app.delete("/api/live/recorder")
def recorder_stop() -> RecorderStatus:
    """Stop the recorder (it closes the recording first)."""
    recorder.stop()
    return recorder_status()


@app.get(
    "/api/live/{year}/{round}/{session}/events",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def live_events(year: int, round: int, session: SessionCode, request: Request):
    """Server-sent events: a `status` event (LiveSessionInfo) whenever the data horizon or the
    version moves (a new version means new laps: refetch the session's data), and a `positions`
    event with the new points of the position track: {first, count, cars} as in /positions, from
    grid point `first` on. Points from before the connection come from /positions."""
    current = live.service.get((year, round, session))
    if current is None:
        raise HTTPException(404, "No live recording of this session")

    async def events() -> AsyncIterator[str]:
        sent = None
        track = current.track
        points = track.count
        while not await request.is_disconnected():
            info = _live_info(current)
            mark = (info.version, info.horizon, info.state, info.status)
            if mark != sent:
                sent = mark
                yield f"event: status\ndata: {json.dumps(info.model_dump())}\n\n"
            if current.track is not track:  # the recording started over
                track, points = current.track, 0
            if track.count > points:
                chunk = {
                    "first": points,
                    "count": track.count,
                    "cars": track.snapshot(current.codes, points),
                }
                points = track.count
                yield f"event: positions\ndata: {json.dumps(chunk, separators=(',', ':'))}\n\n"
            await asyncio.sleep(LIVE_TICK)

    headers = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    return StreamingResponse(events(), media_type="text/event-stream", headers=headers)


# User data: markers per session and saved views, in a local SQLite file (app/store.py).


@app.get("/api/sessions/{year}/{round}/{session}/markers")
def session_markers(year: int, round: int, session: SessionCode) -> list[Marker]:
    return store.list_markers(year, round, session)


@app.post("/api/sessions/{year}/{round}/{session}/markers", status_code=201)
def add_marker(year: int, round: int, session: SessionCode, marker: MarkerIn) -> Marker:
    return store.add_marker(year, round, session, marker)


@app.put("/api/markers/{marker_id}")
def update_marker(marker_id: int, marker: MarkerIn) -> Marker:
    return _guard(lambda: store.update_marker(marker_id, marker))


@app.delete("/api/markers/{marker_id}", status_code=204)
def delete_marker(marker_id: int) -> None:
    _guard(lambda: store.delete_marker(marker_id))


@app.get("/api/markers/tags")
def marker_tags() -> list[TagCount]:
    """Tags in use over all sessions, most used first (suggestions in the marker editor)."""
    return store.tag_counts()


@app.get("/api/views")
def views() -> list[View]:
    return store.list_views()


@app.post("/api/views", status_code=201)
def add_view(view: ViewIn) -> View:
    return store.add_view(view)


@app.put("/api/views/{view_id}")
def update_view(view_id: int, view: ViewIn) -> View:
    return _guard(lambda: store.update_view(view_id, view))


@app.delete("/api/views/{view_id}", status_code=204)
def delete_view(view_id: int) -> None:
    _guard(lambda: store.delete_view(view_id))
