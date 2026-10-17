import gzip
from collections.abc import Callable
from contextlib import asynccontextmanager
from datetime import date
from typing import Annotated

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.gzip import GZipMiddleware

from app import analysis, replays, schedule, sessions, store, strategies, strategy
from app.schemas import (
    Circuit,
    ComparedLap,
    Comparison,
    CornerLap,
    CornerSegment,
    Degradation,
    Lap,
    Marker,
    MarkerIn,
    MiniSectors,
    PitWindow,
    RaceControlMessage,
    RaceHistory,
    ReplayPositions,
    ReplayStatus,
    SeasonEvents,
    SessionCode,
    SessionDetail,
    SessionTimeline,
    TagCount,
    Telemetry,
    TimingState,
    View,
    ViewIn,
    Weather,
)
from app.sources.tracinginsights import SourceNotAvailable

FIRST_SEASON = 2018
"""First season with full telemetry."""

MAX_COMPARED_LAPS = 8


@asynccontextmanager
async def lifespan(_: FastAPI):
    schedule.init_cache()
    yield


app = FastAPI(title="F1 Pitwall API", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)


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

        compared = []
        for (code, number), lap, delta in zip(resolved, result.laps, result.deltas, strict=True):
            ch = lap.channels
            compared.append(
                ComparedLap(
                    driver=code,
                    lap=number,
                    lap_time=sessions.lap_time(year, round, session, code, number),
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
                    laps=[
                        CornerLap(
                            time=float(np.round(s.time, 3)),
                            brake_at=_maybe_one_decimal(s.brake_at),
                            min_speed=_one_decimal(s.min_speed),
                            min_speed_at=_one_decimal(s.min_speed_at),
                            throttle_at=_maybe_one_decimal(s.throttle_at),
                            top_speed=_one_decimal(s.top_speed),
                        )
                        for s in segment.laps
                    ],
                )
                for segment in corners
            ],
        )

    return _guard(load)


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
