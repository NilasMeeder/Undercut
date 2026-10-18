"""End-to-end through the API with a fake TracingInsights archive (no network)."""

import time
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import replays, schedule, sessions, strategies
from app.live import recordings
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
        "lST": [40.0, 100.0, 0.0],
        "sesT": [100.0, 160.0, 60.5],
        "lSD": [
            "2025-03-16T05:00:40.000000000",
            "2025-03-16T05:01:40.000000000",
            "2025-03-16T05:00:00.000000000",
        ],
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
    "rcm.json": {
        "time": ["2025-03-16T05:00:00.000000000", "2025-03-16T05:04:17.123456789"],
        "cat": ["Flag", "Other"],
        "msg": ["GREEN LIGHT - PIT EXIT OPEN", "CAR 4 (NOR) TIME 1:00.900 DELETED - TRACK LIMITS"],
        "status": ["None", "None"],
        "flag": ["GREEN", "None"],
        "scope": ["Track", "None"],
        "sector": ["None", "None"],
        "dNum": ["None", "None"],
        "lap": ["None", 3.0],
    },
    "weather.json": {
        "wT": [30.0, 90.0],
        "wAT": [20.1, 20.3],
        "wTT": [35.0, 36.5],
        "wH": [50.0, 51.0],
        "wP": [1010.0, 1010.1],
        "wR": [False, "True"],
        "wWD": [180, 190.0],
        "wWS": [1.2, 2.0],
    },
    "VER/2_tel.json": tel(60.0),
    "NOR/1_tel.json": tel(60.5, length=1004.0),
}


CACHES = (
    sessions.folders,
    sessions.get_t0,
    sessions.get_detail,
    sessions.get_laps,
    sessions.get_trace,
    sessions.get_race_control,
    sessions.get_weather,
    replays.get_timeline,
    replays.get_timing_index,
    replays._stored_positions_gzip,
    strategies.get_history,
    strategies.get_paces,
)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[TestClient]:
    def fake_fetch(year: int, event: str, session: str, file: str):
        if file not in ARCHIVE:
            raise ti.SourceNotAvailable(f"{file} not in TracingInsights")
        return ARCHIVE[file]

    def fake_prefetch(year, event, session, files, progress) -> set[str]:
        progress(1.0)
        return {f for f in files if f not in ARCHIVE}

    monkeypatch.setattr(ti, "fetch_json", fake_fetch)
    monkeypatch.setattr(ti, "prefetch", fake_prefetch)
    monkeypatch.setattr(replays, "REPLAY_CACHE_DIR", tmp_path)
    monkeypatch.setattr(recordings, "LIVE_DIR", tmp_path / "live")
    replays._jobs.clear()
    monkeypatch.setattr(schedule, "resolve_session", lambda y, r, c: (EVENT, EVENT.sessions[0]))
    for cached in CACHES:
        cached.cache_clear()
    yield TestClient(app)
    for cached in CACHES:
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


def test_race_control_parses_time_and_driver(client: TestClient) -> None:
    green, deleted = client.get("/api/sessions/2025/1/Q/race-control").json()
    assert green["utc"] == "2025-03-16T05:00:00Z"
    assert green["flag"] == "GREEN" and green["driver"] is None
    assert deleted["driver"] == "NOR"  # from the message text, dNum is empty
    assert deleted["flag"] is None
    assert deleted["lap"] == 3


def test_weather_is_columnar(client: TestClient) -> None:
    body = client.get("/api/sessions/2025/1/Q/weather").json()
    assert body["time"] == [30.0, 90.0]
    assert body["track_temp"] == [35.0, 36.5]
    assert body["rainfall"] == [False, True]
    assert body["wind_direction"] == [180, 190]


def test_race_control_in_session_time(client: TestClient) -> None:
    """t0 = lSD - lST (05:00:00 UTC here), so the 05:04:17 message is 257 s into the session."""
    green, deleted = client.get("/api/sessions/2025/1/Q/race-control").json()
    assert green["session_time"] == 0.0
    assert deleted["session_time"] == pytest.approx(257.123)


def test_timeline(client: TestClient) -> None:
    body = client.get("/api/sessions/2025/1/Q/timeline").json()
    assert (body["start"], body["end"], body["kind"]) == (0.0, 160.0, "quali")
    assert body["t0_utc"] == "2025-03-16T05:00:00Z"
    assert body["track_status"] == [{"start": 0.0, "end": 160.0, "status": "green"}]


def test_timing_tower_at_t(client: TestClient) -> None:
    early = client.get("/api/sessions/2025/1/Q/timing?t=70").json()
    assert [r["driver"] for r in early["rows"]] == ["NOR", "VER"]
    assert early["valid_until"] == 100.0
    late = client.get("/api/sessions/2025/1/Q/timing?t=200").json()
    assert [(r["driver"], r["gap"]) for r in late["rows"]] == [("VER", None), ("NOR", 0.5)]
    assert late["rows"][0]["best_timing"] == "best"


def test_positions_are_prepared_once(client: TestClient) -> None:
    base = "/api/sessions/2025/1/Q/positions"
    assert client.get(f"{base}/status").json()["state"] == "missing"
    assert client.get(base).status_code == 409
    client.post(f"{base}/prepare")
    for _ in range(100):
        if client.get(f"{base}/status").json()["state"] != "loading":
            break
        time.sleep(0.02)
    assert client.get(f"{base}/status").json()["state"] == "ready"
    body = client.get(base).json()
    assert [c["driver"] for c in body["cars"]] == ["NOR", "VER"]
    nor = body["cars"][0]
    i = round((30.0 - body["start"]) / body["step"])
    assert nor["progress"][i] == pytest.approx(0.5, abs=0.01)
    assert nor["x"][-1] is None  # NOR's only lap ended at 60.5 s


def test_race_history_and_degradation(client: TestClient) -> None:
    history = client.get("/api/sessions/2025/1/Q/race-history").json()
    assert history["kind"] == "quali"
    ver = next(d for d in history["drivers"] if d["driver"] == "VER")
    assert ver["laps"] == [1, 2]
    assert ver["line"] == [100.0, 160.0]
    assert ver["gap"] == [None, None]  # gaps only in a race
    assert ver["stints"][0]["start_lap"] == 1
    deg = client.get("/api/sessions/2025/1/Q/degradation?until=120").json()
    assert deg["until"] == 120.0
    assert deg["fuel_per_lap"] == pytest.approx(0.054)  # 1.8 kg/lap assumed outside races
    assert deg["total_laps"] == 2  # corrected to the session's last lap
    assert all(s["fit"] is None for s in deg["stints"])  # too few laps


def test_pit_window_is_for_races(client: TestClient) -> None:
    response = client.get("/api/sessions/2025/1/Q/pit-window?driver=VER")
    assert response.status_code == 404


def test_lap_progress_cuts_the_lap_off_at_t(client: TestClient) -> None:
    body = client.get("/api/sessions/2025/1/Q/lap-progress?driver=VER&t=130").json()
    assert (body["lap"], body["start"], body["elapsed"]) == (2, 100.0, 30.0)
    assert body["progress"] == pytest.approx(500.0)
    assert body["reference"] is None  # lap 1 (the out-lap) has no telemetry
    assert body["speed"][-1] == 200.0
    assert set(body["delta"]) == {None}
    assert client.get("/api/sessions/2025/1/Q/lap-progress?driver=VER&t=170").status_code == 404
