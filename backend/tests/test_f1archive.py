"""F1's archive with the F1 TV sign-in: the token goes to livetiming.formula1.com only, missing
topics are skipped, and the streams become a recording. The conversion itself is tested in
test_live_roundtrip.py (test_f1s_archive_converts_like_a_recording)."""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import schedule
from app.live import record, recordings
from app.main import app
from app.schemas import EventInfo, SessionInfo
from app.sources import f1archive

PATH = "/static/2026/2026-10-25_United_States_Grand_Prix/2026-10-23_Practice_1/"


class FakeResponse:
    def __init__(self, status: int, body: bytes = b"") -> None:
        self.status_code = status
        self.body = body
        self.headers = {"Content-Length": str(len(body))}

    def iter_content(self, size: int):
        for i in range(0, len(self.body), size):
            yield self.body[i : i + size]

    def close(self) -> None:
        pass

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: Any) -> None:
        pass


@pytest.fixture
def f1(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """F1's archive with a heartbeat, the timing and the driver list; nothing else."""
    files = {
        "Heartbeat": '﻿00:00:10.000{"Utc":"2026-10-23T16:30:10.0000000Z","_kf":true}\r\n'
        '00:00:25.500{"Utc":"2026-10-23T16:30:25.5Z","_kf":true}\r\n',
        "TimingData": '00:00:12.250{"Lines":{"1":{"NumberOfLaps":0}}}\r\nbroken\r\n',
        "DriverList": '00:00:01.000{"1":{"Tla":"VER"}}\r\n',
        "CarData.z": '00:00:11.000"7ZRdb8IwDEX"\r\n',
    }
    calls: list[dict[str, Any]] = []

    def get(url: str, **kwargs: Any) -> FakeResponse:
        calls.append({"url": url, **kwargs})
        name = url.rsplit("/", 1)[1].removesuffix(".jsonStream")
        body = files.get(name)
        return FakeResponse(404) if body is None else FakeResponse(200, body.encode())

    monkeypatch.setattr(f1archive._http, "get", get)
    monkeypatch.setattr(record, "signed_in", lambda now=None: True)
    monkeypatch.setattr(record, "_token", lambda: "eyJtoken.x.y")
    return calls


def test_the_token_goes_to_f1_only(f1: list[dict[str, Any]], tmp_path: Path) -> None:
    found = f1archive.download(PATH, tmp_path)
    assert set(found) == {"Heartbeat", "TimingData", "DriverList", "CarData.z"}
    assert len(f1) == len(f1archive.TOPICS)  # asked for each, missing ones skipped
    for call in f1:
        assert call["url"].startswith("https://livetiming.formula1.com/static/2026/")
        assert call["headers"]["Authorization"] == "Bearer eyJtoken.x.y"
        assert call["allow_redirects"] is False
    with pytest.raises(ValueError):
        f1archive._get("//evil.example/static/x", "eyJtoken.x.y")


def test_the_streams_become_a_recording(f1: list[dict[str, Any]], tmp_path: Path) -> None:
    from app.live import feed

    target = tmp_path / "live.txt"
    f1archive.write_recording(f1archive.download(PATH, tmp_path), target)
    messages = [feed.parse_line(line) for line in target.read_text().splitlines()]
    began = datetime(2026, 10, 23, 16, 30, tzinfo=UTC)
    assert [(m.topic, m.utc) for m in messages] == [
        ("DriverList", None),  # the state a recording starts with
        ("Heartbeat", began + timedelta(seconds=10)),
        ("CarData.z", began + timedelta(seconds=11)),
        ("TimingData", began + timedelta(seconds=12.25)),
        ("Heartbeat", began + timedelta(seconds=25.5)),
    ]
    assert messages[2].data == "7ZRdb8IwDEX"
    assert target.stat().st_mtime == (began + timedelta(seconds=25.5)).timestamp()
    assert not target.with_name("live.txt.part").exists()


def test_f1_refuses_or_has_nothing(
    f1: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(f1archive._http, "get", lambda url, **kw: FakeResponse(403))
    with pytest.raises(f1archive.Refused):
        f1archive.download(PATH, tmp_path)
    monkeypatch.setattr(f1archive._http, "get", lambda url, **kw: FakeResponse(404))
    with pytest.raises(LookupError):
        f1archive.download(PATH, tmp_path)
    monkeypatch.setattr(record, "signed_in", lambda now=None: False)
    with pytest.raises(f1archive.NotSignedIn):
        f1archive.download(PATH, tmp_path)


def test_stamps_and_broken_lines() -> None:
    assert f1archive.parse_stamp("01:02:03.456") == timedelta(hours=1, minutes=2, seconds=3.456)
    assert f1archive.parse_stamp("garbage!!!!!") is None
    lines = ['00:00:01.000{"a":1}', '00:00:02.000"zipped"', "00:00:03.000{oops", ""]
    assert list(f1archive.entries(iter(lines), "TimingData")) == [(timedelta(seconds=1), {"a": 1})]
    assert list(f1archive.entries(iter(lines), "CarData.z")) == [(timedelta(seconds=2), "zipped")]


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> TestClient:
    start = datetime.now(UTC) - timedelta(days=1)  # over
    event = EventInfo(
        round=19,
        name="United States Grand Prix",
        country="United States",
        location="Austin",
        format="sprint_qualifying",
        date=start,
        sessions=[SessionInfo(code="FP1", name="Practice 1", start_utc=start, utc_offset=-300)],
    )
    monkeypatch.setattr(schedule, "resolve_session", lambda y, r, c: (event, event.sessions[0]))
    monkeypatch.setattr(schedule, "api_path", lambda y, r, c: PATH)
    monkeypatch.setattr(recordings, "LIVE_DIR", tmp_path)
    monkeypatch.setattr(record, "signed_in", lambda now=None: False)
    return TestClient(app, base_url="http://localhost")


def test_the_api_offers_a_session_that_is_over(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    url = "/api/sessions/2026/19/FP1/f1-archive"
    event, _ = schedule.resolve_session(2026, 19, "FP1")
    soon = event.sessions[0].model_copy(update={"start_utc": datetime.now(UTC) + timedelta(days=2)})
    later = event.model_copy(update={"sessions": [soon]})
    status = client.get(url).json()
    assert status["state"] == "idle" and status["offered"] and not status["signed_in"]
    monkeypatch.setattr(schedule, "resolve_session", lambda y, r, c: (later, later.sessions[0]))
    assert not client.get(url).json()["offered"]  # not over yet
    monkeypatch.setattr(schedule, "resolve_session", lambda y, r, c: (event, event.sessions[0]))
    refused = client.post(url)
    assert refused.status_code == 403 and "fastf1 auth f1tv" in refused.json()["detail"]

    recordings.write_meta(2026, 19, "FP1", "United States Grand Prix", "Practice 1")
    (recordings.session_dir(2026, "United States Grand Prix", "Practice 1") / "live.txt").touch()
    assert not client.get(url).json()["offered"]  # recorded already
    monkeypatch.setattr(record, "signed_in", lambda now=None: True)
    assert client.post(url).status_code == 409


def test_a_download_waits_for_the_conversion(monkeypatch: pytest.MonkeyPatch) -> None:
    from types import SimpleNamespace

    from app.live import service

    monkeypatch.setattr(f1archive, "import_session", lambda *args: Path("."))
    sessions = iter([None, SimpleNamespace(error=None, finished=False)])
    done = SimpleNamespace(error=None, finished=True)
    monkeypatch.setattr(service.service, "get", lambda key: next(sessions, done))
    monkeypatch.setattr(f1archive.time, "sleep", lambda s: None)
    job = f1archive.Job()
    f1archive._run((2026, 19, "FP1"), PATH, job)
    assert (job.state, job.progress, job.error) == ("ready", 1.0, None)

    monkeypatch.setattr(
        service.service, "get", lambda key: SimpleNamespace(error="bad", finished=False)
    )
    f1archive._run((2026, 19, "FP1"), PATH, job := f1archive.Job())
    assert job.state == "error" and job.error == "Converting failed: bad"
