"""End-to-end through the API with a fake TracingInsights archive (no network)."""

from collections.abc import Iterator

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import schedule, sessions
from app.main import app
from app.schemas import EventInfo, SessionInfo
from app.sources import tracinginsights as ti

EVENT = EventInfo(
    round=1,
    name="Test Grand Prix",
    country="Testland",
    location="Testville",
    format="conventional",
    date="2025-03-16T00:00:00",
    sessions=[SessionInfo(code="Q", name="Qualifying", start_utc=None)],
)


def tel(lap_time: float, length: float = 1000.0) -> dict:
    distance = np.linspace(0.0, length, 101)
    return {
        "tel": {
            "time": (distance / length * lap_time).tolist(),
            "distance": distance.tolist(),
            "speed": [200.0] * 101,
            "throttle": [100.0] * 101,
            "brake": [0] * 101,
            "gear": [7] * 101,
            "rpm": [11000.0] * 101,
            "drs": [0] * 101,
            "x": distance.tolist(),
            "y": [0.0] * 101,
        }
    }


ARCHIVE = {
    "session_laptimes.json": {
        "drv": ["VER", "VER", "NOR"],
        "lap": [1, 2, 1],
        "time": ["None", 60.0, 60.5],
        "s1": ["None", 20.0, 20.1],
        "s2": [21.0, 20.0, 20.2],
        "s3": [22.0, 20.0, 20.2],
        "pb": [False, True, True],
        "del": [False, False, False],
        "iacc": [False, True, True],
        "pin": ["None", "None", "None"],
        "pout": [100.0, "None", "None"],
        "status": ["1", "1", "1"],
    },
    "drivers.json": {
        "drivers": [
            {
                "driver": "VER",
                "dn": "1",
                "fn": "Max",
                "ln": "Verstappen",
                "team": "RB",
                "tc": "4781D7",
            },
            {
                "driver": "NOR",
                "dn": "4",
                "fn": "Lando",
                "ln": "Norris",
                "team": "McL",
                "tc": "F47600",
            },
        ]
    },
    "VER/2_tel.json": tel(60.0),
    "NOR/1_tel.json": tel(60.5, length=1004.0),
}


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    def fake_fetch(year: int, event: str, session: str, file: str):
        if file not in ARCHIVE:
            raise ti.SourceNotAvailable(f"{file} not in TracingInsights")
        return ARCHIVE[file]

    monkeypatch.setattr(ti, "fetch_json", fake_fetch)
    monkeypatch.setattr(schedule, "resolve_session", lambda y, r, c: (EVENT, EVENT.sessions[0]))
    for cached in (sessions._folders, sessions.get_detail, sessions.get_laps, sessions.get_trace):
        cached.cache_clear()
    yield TestClient(app)
    for cached in (sessions._folders, sessions.get_detail, sessions.get_laps, sessions.get_trace):
        cached.cache_clear()


def test_session_detail(client: TestClient) -> None:
    body = client.get("/api/sessions/2025/1/Q").json()
    assert body["event_name"] == "Test Grand Prix"
    assert [d["code"] for d in body["drivers"]] == ["VER", "NOR"]
    assert body["drivers"][0]["color"] == "#4781D7"


def test_laps_normalise_missing_values(client: TestClient) -> None:
    [out_lap, flying, _] = client.get("/api/sessions/2025/1/Q/laps").json()
    assert out_lap["lap_time"] is None
    assert out_lap["pit_out"] is True
    assert flying["lap_time"] == 60.0
    assert flying["personal_best"] is True


def test_compare_resolves_fastest_and_computes_delta(client: TestClient) -> None:
    body = client.get("/api/sessions/2025/1/Q/compare?laps=VER:fastest,NOR&mini_sectors=4").json()
    ver, nor = body["laps"]
    assert (ver["lap"], nor["lap"]) == (2, 1)
    assert nor["delta"][-1] == pytest.approx(0.5)
    assert body["distance"][-1] == pytest.approx(1000.0)
    assert body["mini_sectors"]["fastest"] == [0, 0, 0, 0]
    assert body["corners"] == []  # the fake archive has no corners.json


def test_drs_is_null_from_2026(client: TestClient) -> None:
    body = client.get("/api/sessions/2026/1/Q/telemetry?driver=VER&lap=2").json()
    assert body["drs"] is None
    assert len(body["speed"]) == 101


def test_missing_lap_is_404(client: TestClient) -> None:
    response = client.get("/api/sessions/2025/1/Q/compare?laps=VER:9")
    assert response.status_code == 404


def test_bad_lap_spec_is_422(client: TestClient) -> None:
    assert client.get("/api/sessions/2025/1/Q/compare?laps=XX:1").status_code == 422
