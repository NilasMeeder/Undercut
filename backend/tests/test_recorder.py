"""Starting and stopping the recorder from the API, with a stand-in that only sleeps."""

import os
import signal
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import config, schedule
from app.live import record, recorder
from app.main import app
from app.schemas import EventInfo, SessionInfo

STAND_IN = """
import signal, sys, time
def stop(*args):
    print("Stopped recording", flush=True)
    sys.exit(0)
signal.signal(signal.SIGINT, stop)
print("Recording Test Grand Prix Race", flush=True)
time.sleep(30)
"""


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> TestClient:
    monkeypatch.setattr(config, "LIVE_DIR", tmp_path)
    monkeypatch.setattr(recorder, "command", lambda mode: [sys.executable, "-c", STAND_IN])
    monkeypatch.setattr(record, "signed_in", lambda: True)
    monkeypatch.setattr(record, "sign_in_expires", lambda: None)
    start = datetime(2026, 10, 23, 17, 30, tzinfo=UTC)
    monkeypatch.setattr(record, "current_session", lambda now: (2026, 19, "FP1", start))
    monkeypatch.setattr(record, "upcoming_session", lambda now: None)
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
    return TestClient(app, base_url="http://localhost")


def wait_for(check, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while not check():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.05)


def test_start_and_stop_the_recorder(client: TestClient) -> None:
    idle = client.get("/api/live/recorder").json()
    assert idle["running"] is False and idle["current"]["code"] == "FP1"

    started = client.post("/api/live/recorder").json()
    assert started["running"] is True and started["since"] is not None
    assert client.post("/api/live/recorder").status_code == 409  # one at a time
    wait_for(lambda: "Recording" in " ".join(recorder.log_tail()))

    stopped = client.delete("/api/live/recorder").json()
    wait_for(lambda: not client.get("/api/live/recorder").json()["running"])
    assert "Stopped recording" in " ".join(client.get("/api/live/recorder").json()["log"])
    assert stopped["signed_in"] is True


def test_record_every_session(client: TestClient) -> None:
    started = client.post("/api/live/recorder?mode=always").json()
    assert started["mode"] == "always" and started["automatic"] is True
    assert not recorder.resume()  # it runs

    # The Mac restarted: no recorder, but still automatic. The backend starts it again.
    pid = recorder.running()["pid"]
    os.kill(pid, signal.SIGKILL)
    wait_for(lambda: recorder.running() is None)
    assert client.get("/api/live/recorder").json()["automatic"] is True
    assert recorder.resume()
    assert recorder.running()["pid"] != pid

    # Stopped from the top bar: no longer automatic, nothing to resume.
    stopped = client.delete("/api/live/recorder").json()
    assert stopped["automatic"] is False
    wait_for(lambda: recorder.running() is None)
    assert not recorder.resume()


def test_resume_waits_for_a_sign_in(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    (config.LIVE_DIR / recorder.AUTO).write_text("{}")
    monkeypatch.setattr(record, "signed_in", lambda: False)
    assert not recorder.resume()
    assert recorder.automatic()  # resumes once signed in again


def test_the_recorder_needs_a_sign_in_and_a_session(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(record, "signed_in", lambda: False)
    response = client.post("/api/live/recorder")
    assert response.status_code == 403 and "fastf1 auth f1tv" in response.json()["detail"]
    monkeypatch.setattr(record, "signed_in", lambda: True)
    monkeypatch.setattr(record, "current_session", lambda now: None)
    assert client.post("/api/live/recorder").status_code == 404
    assert recorder.running() is None


def test_an_expired_sign_in_does_not_count() -> None:
    import base64
    import json

    def token(payload: dict) -> str:
        part = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
        return f"eyJhbGciOiJub25lIn0.{part}.c2ln"

    now = datetime(2026, 10, 23, 17, 0, tzinfo=UTC)
    assert record.token_expired(token({"exp": now.timestamp() - 1}), now)
    assert not record.token_expired(token({"exp": now.timestamp() + 3600}), now)
    assert not record.token_expired(token({}), now)  # no expiry: FastF1 decides
    assert record.token_expired("not a token", now)


def test_only_a_recorder_counts_as_one() -> None:
    def matches(command: str) -> bool:
        return recorder.RECORDER_PROCESS.search(command) is not None

    assert matches("/backend/.venv/bin/python3 -m app.live.record")
    assert matches("uv run python -m app.live.record --wait")
    assert not matches("vim app/live/recorder.py")
    assert not matches("python -m app.live.recorder")
    assert not matches("pytest tests/test_recorder.py")


def test_the_log_tail_hides_a_token(client: TestClient) -> None:
    (config.LIVE_DIR / recorder.LOG).write_text("auth function result eyJhbGc.eyJleHAi.c2ln-_x\n")
    assert recorder.log_tail() == ["auth function result <token>"]


class FakeAwake:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def hold(self) -> None:
        self.calls.append("hold")

    def release(self) -> None:
        self.calls.append("release")


def test_waiting_keeps_the_mac_awake_only_close_to_a_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime.now(UTC)
    starts = iter([now + timedelta(hours=8), now + timedelta(hours=2, minutes=30)])
    session = (2026, 19, "FP1", now + timedelta(hours=1))
    checks = iter([None, None, session])
    monkeypatch.setattr(record, "current_session", lambda now: next(checks))
    monkeypatch.setattr(record, "upcoming_session", lambda now: (2026, 19, "FP1", next(starts)))
    monkeypatch.setattr(record, "next_session", lambda now: "next")
    monkeypatch.setattr(record.time, "sleep", lambda seconds: None)
    awake = FakeAwake()
    assert record.wait_for_session(awake) == session  # type: ignore[arg-type]
    assert awake.calls == ["release", "hold"]  # 7 h before: may sleep; 1.5 h before: awake


def test_always_records_one_session_after_the_other(monkeypatch: pytest.MonkeyPatch) -> None:
    start = datetime(2026, 10, 23, 17, 30, tzinfo=UTC)
    waits = iter([OSError("no network"), (2026, 19, "FP1", start), (2026, 19, "SQ", start)])

    def wait(awake, forever):
        assert forever
        found = next(waits)
        if isinstance(found, Exception):
            raise found
        return found

    recorded: list[str] = []

    def record_session(year, round_number, code, start, no_auth, awake):
        recorded.append(code)
        return code == "SQ"  # stopped during SQ

    monkeypatch.setattr(record, "wait_for_session", wait)
    monkeypatch.setattr(record, "record_session", record_session)
    monkeypatch.setattr(record, "signed_in", lambda: True)
    monkeypatch.setattr(record.time, "sleep", lambda seconds: None)
    record.record_always(FakeAwake(), no_auth=False)  # type: ignore[arg-type]
    assert recorded == ["FP1", "SQ"]


def test_always_gives_up_on_an_expired_sign_in(monkeypatch: pytest.MonkeyPatch) -> None:
    start = datetime(2026, 10, 23, 17, 30, tzinfo=UTC)
    monkeypatch.setattr(record, "wait_for_session", lambda awake, forever: (2026, 19, "FP1", start))
    monkeypatch.setattr(record, "signed_in", lambda: False)
    monkeypatch.setattr(record, "record_session", lambda *args: pytest.fail("recorded"))
    record.record_always(FakeAwake(), no_auth=False)  # type: ignore[arg-type]


def test_the_health_of_the_recording(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.live import feed, recordings

    monkeypatch.setattr(recordings, "LIVE_DIR", config.LIVE_DIR)
    assert client.get("/api/live/recorder").json()["health"] is None  # nothing recorded yet

    folder = recordings.write_meta(2026, 19, "FP1", "United States Grand Prix", "Practice 1")
    path = folder / recordings.RECORDING
    stamp = datetime(2026, 10, 23, 17, 31, 2, 500000, tzinfo=UTC)
    path.write_text(
        feed.state_line("SessionInfo", {"Name": "Practice 1"})
        + "\n"
        + feed.update_line("Heartbeat", {"Utc": "x"}, stamp)
        + "\n['CarData.z', 'half a li"
    )
    (config.LIVE_DIR / recorder.LOG).write_text(
        "Reconnecting in 10 s\n"  # an earlier session
        f"INFO Recording United States Grand Prix Practice 1 into {path} until 19:30 UTC\n"
        "ERROR The live client stopped\nINFO Reconnecting in 10 s\n"
        "INFO Reconnecting in 10 s\n"
    )
    health = client.get("/api/live/recorder").json()["health"]
    assert health["session"] == "United States Grand Prix Practice 1"
    assert health["feed_utc"] == "2026-10-23T17:31:02.500000Z"
    assert health["reconnects"] == 2
    assert health["size"] == path.stat().st_size and health["error"] is None


def test_when_the_sign_in_runs_out() -> None:
    import base64
    import json

    part = base64.urlsafe_b64encode(json.dumps({"exp": 1793000000}).encode()).rstrip(b"=")
    token = f"eyJhbGciOiJub25lIn0.{part.decode()}.c2ln"
    assert record.token_expiry(token) == datetime.fromtimestamp(1793000000, UTC)
    assert record.token_expiry("not a token") is None
