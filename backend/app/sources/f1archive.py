"""F1's own archive (livetiming.formula1.com/static), for a session that TracingInsights does not
have and that was not recorded. Since 14 Oct 2026 it needs the F1 TV sign-in (FastF1's, the same
as the recorder's). The token goes to livetiming.formula1.com only, in a header, never to FastF1's
mirror, and is never logged or returned.

The archive keeps each topic of the live feed as `<Topic>.jsonStream`: per line the time since the
streams began (HH:MM:SS.mmm) and the message as JSON. Downloaded topic by topic and merged into a
recording (live.txt, the recorder's format; UTC from Heartbeat's `Utc`), the live service converts
it like any finished recording: the session then works like a recorded one, with what the
TracingInsights archive lacks (F1's mini-sectors, pit stop times).
"""

import heapq
import json
import logging
import os
import statistics
import tempfile
import threading
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

import requests

from app import config
from app.live import feed, recordings

HOST = "https://livetiming.formula1.com"
"""The only place the token is sent."""
TOPICS = (
    "SessionInfo", "Heartbeat", "DriverList", "SessionStatus", "SessionData", "TimingData",
    "TimingAppData", "TimingStats", "LapCount", "TrackStatus", "ExtrapolatedClock",
    "RaceControlMessages", "WeatherData", "TeamRadio", "TopThree", "PitStopSeries",
    "PitLaneTimeCollection", "ChampionshipPrediction", "Position.z", "CarData.z",
)  # fmt: skip
"""The recorder's topics, and a few it is not subscribed to. Missing ones (404) are skipped."""
REQUIRED = ("Heartbeat", "TimingData", "DriverList")
AS_STATE = ("DriverList",)
"""Topics whose first entry is written as the state a recording starts with (no time): FastF1
skips drivers that a DriverList update names more than an hour into the data."""
STAMP = len("00:00:00.000")
CHUNK = 1 << 16
SOURCE = "f1-archive"
"""meta.json `source` of a recording made from the archive."""

log = logging.getLogger(__name__)
_http = requests.Session()

State = Literal["idle", "downloading", "converting", "ready", "error"]


class NotSignedIn(Exception):
    pass


class Refused(Exception):
    """F1 said no (401/403): the sign-in is not valid for the archive."""


@dataclass
class Job:
    state: State = "downloading"
    progress: float = 0.0
    phase: str | None = "Starting"
    error: str | None = None


_jobs: dict[tuple[int, int, str], Job] = {}
_guard = threading.Lock()


def _token() -> str:
    from app.live import record

    if not record.signed_in():
        raise NotSignedIn(
            "Not signed in to F1 TV, or the sign-in expired. In backend/: "
            "uv run python -m fastf1 auth f1tv --authenticate"
        )
    return record._token()


def _get(path: str, token: str) -> requests.Response | None:
    """A streamed GET of HOST + path with the token; None if F1 has no such file."""
    if not path.startswith("/static/"):
        raise ValueError(f"Not an archive path: {path}")
    response = _http.get(
        HOST + path,
        headers={"Authorization": f"Bearer {token}", "User-Agent": "BestHTTP"},
        timeout=config.HTTP_TIMEOUT_SECONDS,
        stream=True,
        allow_redirects=False,  # a redirect elsewhere must not get the token
    )
    if response.status_code == 404:
        response.close()
        return None
    if response.status_code in (401, 403):
        response.close()
        raise Refused(f"F1 refused the F1 TV sign-in ({response.status_code}): sign in again")
    if response.status_code != 200:
        response.close()
        raise OSError(f"F1's archive answered {response.status_code} for {path}")
    return response


def parse_stamp(text: str) -> timedelta | None:
    """'01:02:03.456' -> timedelta."""
    try:
        hours, minutes, seconds = text.split(":")
        return timedelta(hours=int(hours), minutes=int(minutes), seconds=float(seconds))
    except ValueError:
        return None


def entries(lines: Iterator[str], topic: str) -> Iterator[tuple[timedelta, Any]]:
    """(time since the streams began, message) of a jsonStream; broken lines are skipped."""
    for line in lines:
        line = line.lstrip("﻿").rstrip("\r\n")
        offset = parse_stamp(line[:STAMP])
        if offset is None:
            continue
        try:
            data = json.loads(line[STAMP:])
        except json.JSONDecodeError:
            continue
        if topic.endswith(".z") != isinstance(data, str):
            continue
        yield offset, data


def stream_start(heartbeats: Iterator[tuple[timedelta, Any]]) -> datetime:
    """The UTC at which the streams began: each heartbeat says the time, the median of all."""
    starts = []
    for offset, data in heartbeats:
        utc = feed.parse_utc(data.get("Utc", "")) if isinstance(data, dict) else None
        if utc is not None:
            starts.append((utc - offset).timestamp())
    if not starts:
        raise LookupError("F1's archive has no heartbeat with a time for this session")
    return datetime.fromtimestamp(statistics.median(starts), UTC)


def merge(streams: dict[str, Path], start: datetime) -> Iterator[tuple[datetime, str]]:
    """(UTC, recording line) of all topics, in time order (each stream already is)."""

    def lines(topic: str, path: Path) -> Iterator[tuple[timedelta, int, str, Any]]:
        order = TOPICS.index(topic) if topic in TOPICS else len(TOPICS)
        with path.open(encoding="utf-8", errors="replace") as f:
            for offset, data in entries(f, topic):
                yield offset, order, topic, data

    first = set(AS_STATE)
    for offset, _, topic, data in heapq.merge(*(lines(t, p) for t, p in streams.items())):
        if topic in first:
            first.discard(topic)
            yield start + offset, feed.state_line(topic, data)
        else:
            yield start + offset, feed.update_line(topic, data, start + offset)


def download(
    api_path: str, folder: Path, progress: Callable[[float], None] = lambda _: None
) -> dict[str, Path]:
    """Every topic of the session into `folder` as <Topic>.jsonStream; the ones F1 has."""
    token = _token()
    found: dict[str, Path] = {}
    for index, topic in enumerate(TOPICS):
        response = _get(f"{api_path}{topic}.jsonStream", token)
        if response is None:
            continue
        total = int(response.headers.get("Content-Length") or 0)
        done = 0
        path = folder / f"{topic}.jsonStream"
        with response, path.open("wb") as out:
            for chunk in response.iter_content(CHUNK):
                out.write(chunk)
                done += len(chunk)
                part = min(done / total, 1.0) if total else 0.5
                progress((index + part) / len(TOPICS))
        found[topic] = path
    missing = [topic for topic in REQUIRED if topic not in found]
    if missing:
        raise LookupError(f"F1's archive has no data for this session ({', '.join(missing)})")
    return found


def write_recording(streams: dict[str, Path], target: Path) -> None:
    """The recording, written next to `target` and then moved there (the live service must not
    read half of it); dated at its last message, so it does not look live."""
    with streams["Heartbeat"].open(encoding="utf-8", errors="replace") as f:
        start = stream_start(entries(f, "Heartbeat"))
    part = target.with_name(target.name + ".part")
    last = start
    with part.open("w") as out:
        for last, line in merge(streams, start):  # noqa: B007 (last: the time of the last one)
            out.write(line + "\n")
    os.utime(part, (last.timestamp(), last.timestamp()))
    os.replace(part, target)


def import_session(
    year: int,
    round_number: int,
    code: str,
    api_path: str,
    progress: Callable[[float], None] = lambda _: None,
) -> Path:
    """Download the session and write it as a recording; returns its folder."""
    from app import sessions

    event, session = sessions.folders(year, round_number, code)
    folder = recordings.session_dir(year, event, session)
    target = folder / recordings.RECORDING
    if target.exists():
        raise FileExistsError("This session is already recorded")
    folder.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=folder, prefix=".download-") as scratch:
        streams = download(api_path, Path(scratch), progress)
        write_recording(streams, target)
    recordings.write_meta(year, round_number, code, event, session, source=SOURCE)
    return folder


# --- Jobs (one per session, in a thread) ---------------------------------------------------------

CONVERT_WAIT = 600
"""Seconds to wait for the live service to convert the recording."""


def status(year: int, round_number: int, code: str) -> Job:
    job = _jobs.get((year, round_number, code))
    return job if job is not None else Job(state="idle", phase=None)


def start(year: int, round_number: int, code: str, api_path: str) -> Job:
    """Start downloading the session unless that is going on; refuses (NotSignedIn) up front."""
    _token()
    key = (year, round_number, code)
    with _guard:
        job = _jobs.get(key)
        if job is None or job.state in ("error", "ready"):
            job = _jobs[key] = Job()
            threading.Thread(target=_run, args=(key, api_path, job), daemon=True).start()
    return job


def _run(key: tuple[int, int, str], api_path: str, job: Job) -> None:
    from app.live.service import service  # imports the data layer, which may import this

    def progress(fraction: float) -> None:
        job.progress = round(fraction * 0.9, 3)

    try:
        job.phase = "Downloading from F1"
        import_session(*key, api_path, progress)
        job.state, job.phase, job.progress = "converting", "Converting", 0.9
        deadline = time.monotonic() + CONVERT_WAIT
        while time.monotonic() < deadline:
            live = service.get(key)
            if live is not None and live.error:
                raise RuntimeError(f"Converting failed: {live.error}")
            if live is not None and live.finished:
                break
            time.sleep(1)
        else:
            raise TimeoutError("The recording was not converted in time")
        job.state, job.phase, job.progress = "ready", None, 1.0
    except Exception as error:
        # Never the token: the messages above and requests' errors name the URL at most.
        log.warning("Downloading %s from F1's archive failed: %s", key, error)
        job.state, job.phase = "error", None
        job.error = str(error) or type(error).__name__
