"""TracingInsights season repos (github.com/TracingInsights/<year>): FastF1-derived JSON.

Files are fetched from raw.githubusercontent.com and stored gzipped on disk, so every file is
downloaded once. Layout: <year>/<EventName>/<SessionName>/{session_laptimes,drivers,corners}.json
and <DRV>/<lap>_tel.json. Missing values are the string "None".
"""

import gzip
import json
import logging
import os
import subprocess
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests

from app.config import (
    HTTP_TIMEOUT_SECONDS,
    LIVE_DIR,
    RADIO_CACHE_DIR,
    TRACINGINSIGHTS_BASE_URL,
    TRACINGINSIGHTS_CACHE_DIR,
)
from app.sources import tracinginsights_git as ti_git

log = logging.getLogger(__name__)


class SourceNotAvailable(Exception):
    """The requested file does not exist (yet) in the TracingInsights archive."""


_http = requests.Session()
_http.headers["User-Agent"] = "f1dash (hobby project)"

# Endpoints run in a thread pool, and one click can fire two requests for the same lap. A lock per
# file makes the second wait for the first download instead of fetching and writing it again.
_locks: dict[Path, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(path: Path) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(path, threading.Lock())


def _cache_path(year: int, event: str, session: str, file: str) -> Path:
    return TRACINGINSIGHTS_CACHE_DIR / str(year) / event / session / f"{file}.gz"


def _live_path(year: int, event: str, session: str, file: str) -> Path:
    return LIVE_DIR / str(year) / event / session / "converted" / f"{file}.gz"


READ_LIVE = True
"""Off for the live simulator, which turns the archive itself into a feed."""


def live_file(year: int, event: str, session: str, file: str) -> Any | None:
    """A file only a live recording has (live.json), or None; never downloads."""
    path = _live_path(year, event, session, file)
    if not READ_LIVE:
        return None
    if not path.exists():
        return None
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def fetch_json(year: int, event: str, session: str, file: str) -> Any:
    # A live recording (app/live) is converted to the same files; it wins over the archive, which
    # has no session in progress and may never publish sessions recorded live.
    if (live := live_file(year, event, session, file)) is not None:
        return live
    path = _cache_path(year, event, session, file)
    if not path.exists():
        with _lock_for(path):
            if not path.exists():
                return _download(year, event, session, file, path)
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def _download(year: int, event: str, session: str, file: str, path: Path) -> Any:
    url = f"{TRACINGINSIGHTS_BASE_URL}/{year}/main/{quote(event)}/{quote(session)}/{quote(file)}"
    response = _http.get(url, timeout=HTTP_TIMEOUT_SECONDS)
    if response.status_code == 404:
        raise SourceNotAvailable(f"{year} {event} {session}: {file} not in TracingInsights")
    response.raise_for_status()
    data = response.json()
    write_gzip(path, json.dumps(data, separators=(",", ":")).encode())
    return data


RADIO_URL_PREFIX = "https://livetiming.formula1.com/static/"


def fetch_radio(year: int, event: str, session: str, driver: str, file: str, url: str) -> bytes:
    """A team radio clip (mp3), cached as is: from the archive (which keeps the clips beside the
    telemetry), else from where F1 published it (a live recording only knows that)."""
    path = RADIO_CACHE_DIR / str(year) / event / session / driver / file
    if path.exists():
        return path.read_bytes()
    with _lock_for(path):
        if path.exists():
            return path.read_bytes()
        archive = (
            f"{TRACINGINSIGHTS_BASE_URL}/{year}/main/{quote(event)}/{quote(session)}/"
            f"{quote(driver)}/radio/{quote(file)}"
        )
        # The URL comes from a data file: only F1's own static files, nothing on this network.
        published = [url] if url.startswith(RADIO_URL_PREFIX) else []
        for source in (archive, *published):
            response = _http.get(source, timeout=HTTP_TIMEOUT_SECONDS)
            if response.ok and response.content:
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
                tmp.write_bytes(response.content)
                tmp.replace(path)
                return response.content
    raise SourceNotAvailable(f"{year} {event} {session}: radio {file} not found")


def write_gzip(path: Path, raw: bytes) -> None:
    """Write gzipped via a temp file, so a reader never sees half a file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    with gzip.open(tmp, "wb", compresslevel=6) as f:
        f.write(raw)
    tmp.replace(path)


def is_cached(year: int, event: str, session: str, file: str) -> bool:
    return _cache_path(year, event, session, file).exists()


def store(year: int, event: str, session: str, file: str, raw: bytes) -> None:
    """Cache a file obtained in bulk (see prefetch); `raw` is the JSON as served."""
    write_gzip(_cache_path(year, event, session, file), raw)


Progress = Callable[[float], None]
"""Called with the fraction done, 0 to 1."""

HTTP_WORKERS = 8
"""Parallel downloads when git is not available: enough to be quick, not enough to hammer GitHub."""


def prefetch(year: int, event: str, session: str, files: list[str], progress: Progress) -> set[str]:
    """Bring many files into the cache at once (a session's telemetry: ~1000 files for a race).

    A git partial clone fetches them in one request (~15 s for a race); plain HTTP is the fallback
    (~45 s). Returns the files that are not in the archive.
    """
    missing = [f for f in files if not is_cached(year, event, session, f)]
    if not missing:
        progress(1.0)
        return set()
    try:
        return ti_git.prefetch(
            year,
            f"{event}/{session}",
            missing,
            progress,
            lambda file, raw: store(year, event, session, file, raw),
        )
    except (OSError, subprocess.SubprocessError, ti_git.GitError) as error:
        log.warning("git prefetch failed (%s), falling back to HTTP", error)
    # Whatever git did cache before failing does not need downloading again.
    missing = [f for f in missing if not is_cached(year, event, session, f)]
    return _prefetch_http(year, event, session, missing, progress)


def _prefetch_http(
    year: int, event: str, session: str, files: list[str], progress: Progress
) -> set[str]:
    absent: set[str] = set()
    done = 0

    def get(file: str) -> None:
        try:
            fetch_json(year, event, session, file)
        except SourceNotAvailable:
            absent.add(file)

    with ThreadPoolExecutor(HTTP_WORKERS) as pool:
        for future in as_completed(pool.submit(get, f) for f in files):
            future.result()
            done += 1
            progress(done / len(files))
    return absent


def clean(value: Any) -> Any:
    """Map the archive's "None" strings to None."""
    return None if value == "None" else value


def session_laps(year: int, event: str, session: str) -> dict[str, list[Any]]:
    data = fetch_json(year, event, session, "session_laptimes.json")
    return {key: [clean(v) for v in values] for key, values in data.items()}


def drivers(year: int, event: str, session: str) -> list[dict[str, Any]]:
    data = fetch_json(year, event, session, "drivers.json")
    return data["drivers"] if isinstance(data, dict) else data


def corners(year: int, event: str, session: str) -> dict[str, Any]:
    return fetch_json(year, event, session, "corners.json")


def lap_telemetry(year: int, event: str, session: str, driver: str, lap: int) -> dict[str, list]:
    data = fetch_json(year, event, session, f"{driver}/{lap}_tel.json")
    return data["tel"]


def _columns(year: int, event: str, session: str, file: str) -> dict[str, list[Any]]:
    data = fetch_json(year, event, session, file)
    return {key: [clean(v) for v in values] for key, values in data.items()}


def race_control(year: int, event: str, session: str) -> dict[str, list[Any]]:
    """Columns time (UTC, ISO), cat, msg, status, flag, scope, sector, dNum, lap."""
    return _columns(year, event, session, "rcm.json")


def weather(year: int, event: str, session: str) -> dict[str, list[Any]]:
    """Columns wT (session time, s), wAT/wTT (air/track °C), wH, wP, wR, wWD, wWS."""
    return _columns(year, event, session, "weather.json")
