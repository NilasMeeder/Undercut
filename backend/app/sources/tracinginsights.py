"""TracingInsights season repos (github.com/TracingInsights/<year>): FastF1-derived JSON.

Files are fetched from raw.githubusercontent.com and stored gzipped on disk, so every file is
downloaded once. Layout: <year>/<EventName>/<SessionName>/{session_laptimes,drivers,corners}.json
and <DRV>/<lap>_tel.json. Missing values are the string "None".
"""

import gzip
import json
import os
import threading
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests

from app.config import (
    HTTP_TIMEOUT_SECONDS,
    TRACINGINSIGHTS_BASE_URL,
    TRACINGINSIGHTS_CACHE_DIR,
)


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


def fetch_json(year: int, event: str, session: str, file: str) -> Any:
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

    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    tmp.replace(path)
    return data


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
