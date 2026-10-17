"""Live sessions: follow recordings as they grow and convert them to the archive's files.

A recording folder (<LIVE_DIR>/<year>/<event>/<session>/, see recordings.py) holds the feed
(live.txt) and meta.json ({"year", "round", "code"}). A background thread reads what was added to
every recording that is still being written, and every few seconds hands the timing messages to
FastF1 and writes the result where the archive reader looks first (.cache/live/, see
sources/tracinginsights.py). Each conversion bumps the session's generation, which expires its
cached laps, timeline and strategy (generations.py). Recordings that are no longer written to are
converted once.
"""

import contextlib
import json
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import fastf1
import fastf1.exceptions
import numpy as np

from app import generations, replays, schedule, sessions
from app.config import LIVE_DIR
from app.live import convert, feed, recordings, telemetry
from app.live.telemetry import Samples
from app.live.track import LiveTrack, Outline
from app.sources import tracinginsights as ti

log = logging.getLogger(__name__)

ACTIVE_FOR = 120.0
"""A recording written to in the last two minutes is live."""
ENDED = ("Finalised", "Ends")
"""Session statuses after which nothing changes any more."""
POLL_EVERY = 0.5
BUILD_EVERY = 3.0
"""Seconds between two conversions while data comes in (one takes ~0.2-1 s for a race)."""
SCAN_EVERY = 5.0

ARCHIVE_SESSIONS = (
    "Qualifying",
    "Race",
    "Sprint Qualifying",
    "Sprint",
    "Practice 1",
    "Practice 2",
    "Practice 3",
)
"""Where to borrow the circuit (corners.json) from when the archive lacks this session."""

_fastf1_lock = threading.Lock()
"""FastF1's cache switch is global; one conversion at a time."""


@dataclass
class LiveSession:
    year: int
    round: int
    code: str
    folder: Path
    event: str = ""
    session: str = ""
    origin: datetime | None = None
    timing: list[feed.Message] = field(default_factory=list)
    horizon: float | None = None
    """Session time of the newest message."""
    status: str | None = None
    """F1's session status: Inactive, Started, Aborted, Finished, Finalised, Ends."""
    version: int = 0
    error: str | None = None
    dirty: bool = False
    built_at: float = 0.0
    tail: feed.Tail | None = None
    track: LiveTrack = field(default_factory=LiveTrack)
    codes: dict[str, str] = field(default_factory=dict)
    """Car number -> driver code, from DriverList."""
    outline: Outline | None = None
    outline_tried: bool = False
    finished: bool = False
    """Converted for good (the recording stopped growing); timing and track are freed."""
    car_data: dict[str, Samples] = field(default_factory=dict)
    """Car number -> CarData.z samples."""
    laps: list[tuple[str, int, float, float]] = field(default_factory=list)
    """Completed laps of the last conversion: (driver, lap, start, end)."""
    written: set[tuple[str, int]] = field(default_factory=set)
    """Laps whose telemetry file is written."""

    def __post_init__(self) -> None:
        self.event, self.session = sessions.folders(self.year, self.round, self.code)
        _, info = schedule.resolve_session(self.year, self.round, self.code)
        self.origin = info.start_utc.to_pydatetime() if info.start_utc is not None else None
        self.tail = feed.Tail(self.folder / recordings.RECORDING)

    @property
    def key(self) -> generations.Key:
        return (self.year, self.round, self.code)

    @property
    def out(self) -> Path:
        return self.folder / recordings.CONVERTED

    def written_at(self) -> float:
        try:
            return (self.folder / recordings.RECORDING).stat().st_mtime
        except FileNotFoundError:
            return 0.0

    def is_active(self) -> bool:
        """Still being written, and F1 has not closed the session (the feed's heartbeats go on)."""
        if self.status in ENDED:
            return False
        return time.time() - self.written_at() < ACTIVE_FOR

    def poll(self) -> None:
        assert self.tail is not None
        messages = self.tail.read()
        if self.tail.restarted:
            self.timing, self.horizon, self.status = [], None, None
            self.track, self.car_data, self.laps, self.written = LiveTrack(), {}, [], set()
        for message in messages:
            if self.origin is None and message.utc is not None:
                self.origin = message.utc
            at = None
            if message.utc is not None and self.origin is not None:
                at = convert.session_time(message.utc, self.origin)
                self.horizon = at if self.horizon is None else max(self.horizon, at)
            if message.topic == "Position.z":
                self._positions(message.data)
                continue
            if message.topic == "CarData.z":
                self._car_data(message.data)
                continue
            data = message.data if isinstance(message.data, dict) else {}
            if message.topic == "SessionStatus":
                self.status = data.get("Status", self.status)
            elif message.topic == "DriverList":
                for number, entry in data.items():
                    if isinstance(entry, dict) and entry.get("Tla"):
                        self.codes[number] = entry["Tla"]
            elif message.topic == "TimingData":
                # The initial state has no time: it holds as of the first message.
                self._lap_counts(data, at if at is not None else (self.horizon or -1e6))
            self.timing.append(message)
            self.dirty = True
        if self.outline_tried:
            self.track.extend(self.outline)

    def _positions(self, raw: Any) -> None:
        if self.origin is None or not isinstance(raw, str):
            return
        try:
            data = feed.inflate(raw)
        except (ValueError, OSError):
            return
        for sample in data.get("Position", []):
            stamp = feed.parse_utc(sample.get("Timestamp", ""))
            if stamp is None:
                continue
            at = convert.session_time(stamp, self.origin)
            for number, entry in (sample.get("Entries") or {}).items():
                try:
                    x, y = float(entry["X"]), float(entry["Y"])
                except (KeyError, TypeError, ValueError):
                    continue
                status = str(entry.get("Status", "OnTrack"))
                on_track = status == "OnTrack" or status == "0"
                z = float(entry.get("Z") or 0)
                self.track.add_position(at, number, x, y, z, on_track)

    def _car_data(self, raw: Any) -> None:
        if self.origin is None or not isinstance(raw, str):
            return
        try:
            data = feed.inflate(raw)
        except (ValueError, OSError):
            return
        for entry in data.get("Entries", []):
            stamp = feed.parse_utc(entry.get("Utc", ""))
            if stamp is None:
                continue
            at = convert.session_time(stamp, self.origin)
            for number, car in (entry.get("Cars") or {}).items():
                channels = car.get("Channels") if isinstance(car, dict) else None
                if isinstance(channels, dict):
                    samples = self.car_data.setdefault(number, Samples())
                    samples.add(at, telemetry.car_sample(channels))

    def write_telemetry(self, final: bool = False) -> None:
        """A telemetry file per completed lap, once its samples are in (all of them: `final`)."""
        if self.horizon is None:
            return
        numbers = {code: number for number, code in self.codes.items()}
        for driver, lap, start, end in self.laps:
            if (driver, lap) in self.written or (not final and end > self.horizon - 2):
                continue
            number = numbers.get(driver)
            car, own = self.car_data.get(number or ""), self.track.cars.get(number or "")
            tel = (
                telemetry.lap_telemetry(car, own.raw, start, end)
                if car is not None and own is not None
                else None
            )
            if tel is not None:
                raw = json.dumps({"tel": tel}, separators=(",", ":")).encode()
                ti.write_gzip(self.out / driver / f"{lap}_tel.json.gz", raw)
            if tel is not None or final or end < self.horizon - 60:
                self.written.add((driver, lap))

    def _lap_counts(self, data: dict[str, Any], at: float) -> None:
        for number, line in (data.get("Lines") or {}).items():
            if isinstance(line, dict) and isinstance(line.get("NumberOfLaps"), int):
                self.track.add_lap_count(at, number, line["NumberOfLaps"])

    def load_outline(self) -> None:
        """The circuit, once the first conversion has made (or borrowed) corners.json."""
        self.outline_tried = True
        try:
            circuit = sessions.get_circuit(self.year, self.round, self.code)
        except (ti.SourceNotAvailable, LookupError, ValueError):
            return
        self.outline = Outline(
            x=np.asarray(circuit.track_x, dtype=float),
            y=np.asarray(circuit.track_y, dtype=float),
            distance=np.asarray(circuit.track_distance, dtype=float),
            length=circuit.lap_length,
        )

    def track_path(self) -> Path:
        return self.out / f"track-v{replays.TRACK_VERSION}.npz"

    def finish(self) -> None:
        """The recording stopped: keep the position track as a replay track, free memory."""
        self.write_telemetry(final=True)
        if self.track.count > 0 and self.outline is not None:
            replays.save_track(self.track_path(), self.track.to_track(self.codes, self.outline))
        self.timing, self.track, self.finished = [], LiveTrack(), True
        self.car_data, self.laps = {}, []
        generations.bump(self.key)  # no longer live: the tower's last laps are final now

    def build(self) -> None:
        """Convert the timing messages so far and publish them as a new generation."""
        self.dirty = False
        self.built_at = time.monotonic()
        if self.origin is None or not self.timing:
            return
        livedata = convert.live_timing_data(self.timing, self.origin)
        with _fastf1_lock, fastf1.Cache.disabled():
            session = convert.load_session(self.year, self.round, self.code, livedata, False)
        files: dict[str, Any] = {
            "drivers.json": convert.driver_rows(session),
            # The laps so far do not tell how many there will be.
            "live.json": {"total_laps": _total_laps(session)},
        }
        with contextlib.suppress(fastf1.exceptions.DataNotLoadedError):  # no laps yet
            laps = files["session_laptimes.json"] = convert.lap_columns(session, self.origin)
            self.laps = [
                (driver, lap, start, end)
                for driver, lap, start, end in zip(
                    laps["drv"], laps["lap"], laps["lST"], laps["sesT"], strict=True
                )
                if driver and lap is not None and start is not None and end is not None
            ]
        for name, make in (
            ("rcm.json", convert.race_control_columns),
            ("weather.json", convert.weather_columns),
        ):
            with contextlib.suppress(fastf1.exceptions.DataNotLoadedError, KeyError):
                files[name] = make(session)
        if not (self.out / "corners.json.gz").exists() and (corners := self._borrow_corners()):
            files["corners.json"] = corners
        for name, value in files.items():
            raw = json.dumps(value, separators=(",", ":"), default=str).encode()
            ti.write_gzip(self.out / f"{name}.gz", raw)
        self.write_telemetry()
        self.version = generations.bump(self.key)
        self.error = None
        if not self.outline_tried:
            self.load_outline()

    def _borrow_corners(self) -> dict[str, Any] | None:
        """The circuit from the archive: this session, another of the weekend, or last year's."""
        for year in (self.year, self.year - 1):
            for name in (self.session, *ARCHIVE_SESSIONS):
                try:
                    return ti.fetch_json(year, self.event, name, "corners.json")
                except (ti.SourceNotAvailable, OSError, ValueError):
                    continue
        return None


class Service:
    def __init__(self) -> None:
        self.sessions: dict[generations.Key, LiveSession] = {}
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._scanned = 0.0

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, name="live", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def get(self, key: generations.Key) -> LiveSession | None:
        return self.sessions.get(key)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self.step()
            except Exception:
                log.exception("Live service step failed")
            self._stop.wait(POLL_EVERY)

    def step(self) -> None:
        if time.monotonic() - self._scanned > SCAN_EVERY:
            self._scanned = time.monotonic()
            self.scan()
        for live in list(self.sessions.values()):
            if live.finished:
                continue
            active = live.is_active()
            live.poll()
            due = time.monotonic() - live.built_at > BUILD_EVERY
            if live.dirty and (due or not active):
                try:
                    live.build()
                except Exception as error:
                    log.exception("Converting live session %s failed", live.key)
                    live.error = str(error) or type(error).__name__
                live.poll()  # the first conversion brings the outline: fill the track
            if not active:
                live.finish()

    def rebuild_track(self, key: generations.Key) -> None:
        """The position track of a finished recording, read again from the feed."""
        live = self.sessions.get(key)
        if live is None:
            raise LookupError("No live recording of this session")
        fresh = LiveSession(*key, folder=live.folder)
        fresh.poll()
        fresh.load_outline()
        fresh.poll()
        if fresh.outline is None:
            raise LookupError("No circuit outline for this session")
        replays.save_track(fresh.track_path(), fresh.track.to_track(fresh.codes, fresh.outline))

    def scan(self) -> None:
        for meta in LIVE_DIR.glob("*/*/*/meta.json"):
            try:
                info = json.loads(meta.read_text())
                key = (int(info["year"]), int(info["round"]), str(info["code"]))
            except (OSError, ValueError, KeyError):
                continue
            if key in self.sessions:
                continue
            try:
                live = LiveSession(*key, folder=meta.parent)
            except (KeyError, LookupError) as error:
                log.warning("Skipping recording %s: %s", meta.parent, error)
                continue
            if not live.is_active() and _converted_after(live):
                live.version, live.finished = 1, True
            self.sessions[key] = live


def _total_laps(session: fastf1.core.Session) -> int | None:
    """The race distance from LapCount (races only)."""
    try:
        return session.total_laps
    except fastf1.exceptions.DataNotLoadedError:
        return None


def _converted_after(live: LiveSession) -> bool:
    laps = live.out / "session_laptimes.json.gz"
    return laps.exists() and laps.stat().st_mtime >= live.written_at()


service = Service()
