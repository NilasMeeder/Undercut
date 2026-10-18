"""Replay data per session: the timeline, the timing tower index and the position track.

The position track needs the telemetry of every lap (~1000 files for a race). prepare() builds it in
a background thread and reports progress; the result is stored as an .npz in .cache/replay/, so a
session is downloaded and built only once.
"""

import gzip
import json
import logging
import math
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app import replay, sessions
from app.config import REPLAY_CACHE_DIR
from app.generations import session_cache
from app.live import recordings, tower
from app.schemas import (
    ClockPoint,
    RaceControlMessage,
    ReplayState,
    ReplayStatus,
    SessionTimeline,
    TimingState,
)
from app.sources import jolpica
from app.sources import tracinginsights as ti

log = logging.getLogger(__name__)

TRACK_VERSION = 1
"""Part of the file name: bump it when build_track changes, so stored tracks are rebuilt."""
DOWNLOAD_SHARE = 0.9
"""Of the progress bar; building the track from the cached files is the rest."""

Key = tuple[int, int, str]


def _race_control(year: int, round_number: int, code: str) -> list[RaceControlMessage]:
    try:
        return sessions.get_race_control(year, round_number, code)
    except ti.SourceNotAvailable:
        return []


@session_cache(maxsize=16)
def get_timeline(year: int, round_number: int, code: str) -> SessionTimeline:
    laps = sessions.get_laps(year, round_number, code)
    starts = [lap.start_time for lap in laps if lap.start_time is not None]
    ends = [lap.end_time for lap in laps if lap.end_time is not None]
    if not starts or not ends:
        raise LookupError("This session has no lap timing")
    start, end = min(starts), max(ends)
    kind = replay.session_kind(code)

    lap_starts: list[float] = []
    first_lap = 1
    total_laps = None
    if kind == "race":
        done = max(lap.lap for lap in laps)
        total_laps = max(done, sessions.scheduled_laps(year, round_number, code) or done)
        first: dict[int, float] = {}
        for lap in laps:
            if lap.start_time is not None:
                first[lap.lap] = min(lap.start_time, first.get(lap.lap, math.inf))
        lap_starts = [first[n] for n in sorted(first)]
        first_lap = min(first, default=1)
    messages = _race_control(year, round_number, code)
    parts = replay.segments(laps) if kind == "quali" else []
    status = replay.track_status_periods(messages, start, end)
    return SessionTimeline(
        start=start,
        end=end,
        t0_utc=sessions.get_t0(year, round_number, code),
        kind=kind,
        total_laps=total_laps,
        lap_starts=lap_starts,
        first_lap=first_lap,
        segments=parts,
        track_status=status,
        sector_flags=replay.sector_flag_periods(messages, start, end),
        clock=(_live_clock(year, round_number, code) if kind != "race" else [])
        or replay.session_clock(kind, start, parts, status),
    )


def _live_clock(year: int, round_number: int, code: str) -> list[ClockPoint]:
    """F1's own session clock, from a live recording (live/convert.py clock_columns)."""
    event, session = sessions.folders(year, round_number, code)
    columns = ti.live_file(year, event, session, "clock.json") or {}
    return [
        ClockPoint(t=t, remaining=remaining, running=running)
        for t, remaining, running in zip(
            columns.get("t", []),
            columns.get("remaining", []),
            columns.get("running", []),
            strict=True,
        )
    ]


def starting_grid(year: int, round_number: int, code: str) -> dict[str, int]:
    """Race and sprint grids; without one the tower falls back to the first passage."""
    if code not in ("R", "S"):
        return {}
    try:
        return jolpica.starting_grid(year, round_number, sprint=code == "S")
    except ti.SourceNotAvailable as error:
        log.warning("%s", error)
        return {}


@session_cache(maxsize=8)
def get_timing_index(year: int, round_number: int, code: str) -> replay.TimingIndex:
    timeline = get_timeline(year, round_number, code)
    return replay.build_index(
        sessions.get_laps(year, round_number, code),
        timeline.kind,
        timeline.track_status,
        starting_grid(year, round_number, code),
        timeline.total_laps,
        live=_live(year, round_number, code) is not None,
    )


def timing_state(year: int, round_number: int, code: str, t: float) -> TimingState:
    state = replay.timing_state(get_timing_index(year, round_number, code), t)
    live = _live(year, round_number, code)
    if live is None or not live.tower.changes:
        return state
    # Live: F1's own order, gaps and status from the feed (the laps run a few seconds behind).
    segment = state.segment
    part = int(segment[-1]) - 1 if segment and segment[-1].isdigit() else None
    cars, codes = live.tower.at(t), dict(live.codes)
    return tower.overlay(state, cars, codes, part, live.tower.next_change(t))


# --- Position track ------------------------------------------------------------------------------


@dataclass
class _Job:
    state: ReplayState = "loading"
    progress: float = 0.0
    phase: str | None = "Starting"
    error: str | None = None


_jobs: dict[Key, _Job] = {}
_jobs_guard = threading.Lock()


def _track_path(year: int, round_number: int, code: str) -> Path:
    event, session = sessions.folders(year, round_number, code)
    name = f"track-v{TRACK_VERSION}.npz"
    if recordings.has_recording(year, event, session):
        # Recorded live: its own track (the archive's, if any, has another time origin).
        return recordings.converted_dir(year, event, session) / name
    return REPLAY_CACHE_DIR / str(year) / event / session / name


def _live(year: int, round_number: int, code: str):  # -> LiveSession | None
    """The session while it is live: its track grows in memory (app/live)."""
    from app.live.service import service  # the live service imports this module

    live = service.get((year, round_number, code))
    return live if live is not None and not live.finished else None


def status(year: int, round_number: int, code: str) -> ReplayStatus:
    if (live := _live(year, round_number, code)) is not None:
        if live.track.count > 0:
            return ReplayStatus(state="ready", progress=1.0, phase=None, error=None)
        return ReplayStatus(
            state="loading", progress=0.0, phase="Waiting for positions", error=None
        )
    if _track_path(year, round_number, code).exists():
        return ReplayStatus(state="ready", progress=1.0, phase=None, error=None)
    job = _jobs.get((year, round_number, code))
    if job is None:
        return ReplayStatus(state="missing", progress=0.0, phase=None, error=None)
    return ReplayStatus(state=job.state, progress=job.progress, phase=job.phase, error=job.error)


def prepare(year: int, round_number: int, code: str) -> ReplayStatus:
    """Start building the position track unless it exists or is being built."""
    key = (year, round_number, code)
    event, session = sessions.folders(*key)
    target = _rebuild_live if recordings.has_recording(year, event, session) else _build
    with _jobs_guard:
        current = status(*key)
        if current.state in ("missing", "error"):
            job = _jobs[key] = _Job()
            threading.Thread(target=target, args=(key, job), daemon=True).start()
    return status(*key)


def _rebuild_live(key: Key, job: _Job) -> None:
    """A recorded session without its track (removed, or a newer TRACK_VERSION): from the feed."""
    from app.live.service import service

    try:
        job.phase = "Reading the recording"
        service.rebuild_track(key)
        job.state, job.progress, job.phase = "ready", 1.0, None
    except Exception as error:
        log.exception("Rebuilding the live track for %s failed", key)
        job.state, job.phase, job.error = "error", None, str(error) or type(error).__name__


def _tel_file(driver: str, lap: int) -> str:
    return f"{driver}/{lap}_tel.json"


def _build(key: Key, job: _Job) -> None:
    year, round_number, code = key
    try:
        laps = [
            lap
            for lap in sessions.get_laps(*key)
            if lap.start_time is not None and replay.driven(lap)
        ]
        event, session = sessions.folders(*key)
        job.phase = "Downloading telemetry"

        def progress(fraction: float) -> None:
            job.progress = round(fraction * DOWNLOAD_SHARE, 3)

        files = [_tel_file(lap.driver, lap.lap) for lap in laps]
        absent = ti.prefetch(year, event, session, files, progress)

        job.phase = "Building position track"
        samples = []
        for lap in laps:
            if _tel_file(lap.driver, lap.lap) in absent:
                continue
            tel = ti.lap_telemetry(year, event, session, lap.driver, lap.lap)
            samples.append(
                replay.LapSamples(
                    driver=lap.driver,
                    lap=lap.lap,
                    start=lap.start_time,
                    time=np.asarray(tel["time"], dtype=float),
                    distance=np.asarray(tel["distance"], dtype=float),
                    x=np.asarray(tel["x"], dtype=float),
                    y=np.asarray(tel["y"], dtype=float),
                    # Lap 1 starts on the grid or at the pit exit, out-laps in the pit lane.
                    from_line=not (lap.lap == 1 or lap.pit_out),
                )
            )
        track = replay.build_track(samples, replay.garage_windows(laps))
        save_track(_track_path(*key), track)
        job.state, job.progress, job.phase = "ready", 1.0, None
    except Exception as error:
        log.exception("Building the position track for %s failed", key)
        job.state, job.phase, job.error = "error", None, str(error) or type(error).__name__


def save_track(path: Path, track: replay.Track) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.stem}.tmp.npz")
    np.savez_compressed(
        tmp,
        meta=np.array([track.start, track.step, track.lap_length]),
        drivers=np.array(track.drivers),
        x=track.x.astype(np.float32),
        y=track.y.astype(np.float32),
        progress=track.progress.astype(np.float32),
    )
    tmp.replace(path)


def _ints(values: np.ndarray) -> list[int | None]:
    return [None if math.isnan(v) else round(v) for v in values.tolist()]


def _laps(values: np.ndarray) -> list[float | None]:
    return [None if math.isnan(v) else round(v, 4) for v in values.tolist()]


def positions_gzip(year: int, round_number: int, code: str) -> bytes:
    """The ReplayPositions response as gzipped JSON: it is ~6 MB raw, ~2 MB gzipped."""
    if (live := _live(year, round_number, code)) is not None:
        return gzip.compress(json.dumps(live_positions(live), separators=(",", ":")).encode(), 6)
    return _stored_positions_gzip(year, round_number, code)


def live_positions(live, first: int = 0) -> dict:  # live: LiveSession
    """The live track so far (from grid point `first`), as the positions response."""
    track = live.track
    return {
        "start": float(track.start or 0.0),
        "step": track.step,
        "count": track.count,
        "lap_length": round(live.outline.length, 1) if live.outline else 0.0,
        "cars": track.snapshot(live.codes, first),
    }


@session_cache(maxsize=4)
def _stored_positions_gzip(year: int, round_number: int, code: str) -> bytes:
    """Made once per stored track."""
    path = _track_path(year, round_number, code)
    if not path.exists():
        raise LookupError("The position track is not prepared yet")
    with np.load(path) as data:
        start, step, length = data["meta"].tolist()
        cars = [
            {
                "driver": str(driver),
                "x": _ints(data["x"][i]),
                "y": _ints(data["y"][i]),
                "progress": _laps(data["progress"][i]),
            }
            for i, driver in enumerate(data["drivers"])
        ]
        count = data["x"].shape[1]
    body = {"start": start, "step": step, "count": count, "lap_length": round(length, 1)}
    raw = json.dumps({**body, "cars": cars}, separators=(",", ":")).encode()
    return gzip.compress(raw, compresslevel=6)
