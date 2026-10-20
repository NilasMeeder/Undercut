"""Starting and stopping the recorder from the API, with a stand-in that only sleeps."""

import sys
import time
from datetime import UTC, datetime
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
    monkeypatch.setattr(recorder, "command", lambda wait: [sys.executable, "-c", STAND_IN])
    monkeypatch.setattr(record, "signed_in", lambda: True)
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
