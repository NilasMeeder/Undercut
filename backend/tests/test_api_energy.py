"""/energy through the API with a fake archive of simulated laps (see test_energy)."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import energies, schedule, sessions
from app.analysis import LapTrace, make_grid
from app.live import recordings
from app.main import app
from app.schemas import EventInfo, SessionInfo
from app.sources import tracinginsights as ti

from .test_energy import CORNER, LENGTH, lap

EVENT = EventInfo(
    round=1,
    name="Test Grand Prix",
    country="Testland",
    location="Testville",
    format="conventional",
    date="2026-03-16T00:00:00",
    sessions=[SessionInfo(code="Q", name="Qualifying", start_utc=None, utc_offset=None)],
)


def tel(trace: LapTrace) -> dict:
    return {
        "tel": {
            "time": trace.time.tolist(),
            "distance": trace.distance.tolist(),
            **{name: values.tolist() for name, values in trace.channels.items()},
        }
    }


def laps_file(rows: list[tuple[str, int, float, bool]]) -> dict:
    """(driver, lap, lap time, pit out) per lap; the rest is what is_clean looks at."""
    return {
        "drv": [r[0] for r in rows],
        "lap": [r[1] for r in rows],
        "time": [r[2] for r in rows],
        "del": [False] * len(rows),
        "pin": ["None"] * len(rows),
        "pout": [10.0 if r[3] else "None" for r in rows],
        "status": ["1"] * len(rows),
        "lST": [0.0] * len(rows),
        "sesT": [r[2] for r in rows],
    }


FULL, CLIPPED = lap(), lap(clip_from=600.0)
ARCHIVE = {
    "session_laptimes.json": laps_file(
        [
            ("VER", 1, 99.0, True),
            ("VER", 2, float(FULL.time[-1]), False),
            ("VER", 3, float(FULL.time[-1]), False),
            ("VER", 4, float(FULL.time[-1]), False),
            ("NOR", 2, float(CLIPPED.time[-1]), False),
        ]
    ),
    "corners.json": {
        "CornerNumber": [1, 2],
        "Distance": [CORNER, LENGTH - 100.0],
        "X": [0.0, 0.0],
        "Y": [0.0, 0.0],
        "Angle": [0.0, 0.0],
    },
    "VER/1_tel.json": tel(FULL),
    "VER/2_tel.json": tel(FULL),
    "VER/3_tel.json": tel(FULL),
    "VER/4_tel.json": tel(FULL),
    "NOR/2_tel.json": tel(CLIPPED),
}

CACHES = (
    sessions.folders,
    sessions.get_laps,
    sessions.get_trace,
    sessions.get_circuit,
    energies._lap_runs,
    energies.get_session,
    energies.summary,
)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[TestClient]:
    def fake_fetch(year: int, event: str, session: str, file: str):
        if file not in ARCHIVE:
            raise ti.SourceNotAvailable(f"{file} not in TracingInsights")
        return ARCHIVE[file]

    def fake_prefetch(year, event, session, files, progress) -> set[str]:
        return {f for f in files if f not in ARCHIVE}

    monkeypatch.setattr(ti, "fetch_json", fake_fetch)
    monkeypatch.setattr(ti, "prefetch", fake_prefetch)
    monkeypatch.setattr(recordings, "LIVE_DIR", tmp_path / "live")
    monkeypatch.setattr(schedule, "resolve_session", lambda y, r, c: (EVENT, EVENT.sessions[0]))
    for cached in CACHES:
        cached.cache_clear()
    yield TestClient(app)
    for cached in CACHES:
        cached.cache_clear()


def test_energy_of_laps(client: TestClient) -> None:
    body = client.get("/api/sessions/2026/1/Q/energy?laps=NOR:2,VER:fastest").json()
    assert body["clean_laps"] == 4
    [straight] = body["straights"]
    assert (straight["corner"], straight["after"]) == ("1", "2")
    assert straight["session"]["laps"] == 4
    assert straight["session"]["clipping"] == 0.25
    nor, ver = body["laps"]
    assert (nor["driver"], ver["driver"], ver["lap"]) == ("NOR", "VER", 2)
    [nor_straight] = nor["straights"]
    assert nor_straight["clip_at"] == pytest.approx(600.0, abs=60)
    assert nor_straight["clipping"][-1]["end"] == pytest.approx(nor_straight["end"])
    assert nor_straight["cost_time"] > 0.5
    assert nor["cost_time"] == nor_straight["cost_time"]
    assert ver["straights"][0]["clip_at"] is None
    assert ver["cost_time"] == 0


def test_energy_of_a_lap_that_is_not_clean(client: TestClient) -> None:
    """The out-lap is not in the envelope, but can still be compared against it."""
    body = client.get("/api/sessions/2026/1/Q/energy?laps=VER:1").json()
    assert body["laps"][0]["lap"] == 1


def test_energy_session_summary(client: TestClient) -> None:
    body = client.get("/api/sessions/2026/1/Q/energy/session").json()
    assert [d["driver"] for d in body["drivers"]] == ["VER", "NOR"]
    ver, nor = body["drivers"]
    assert (ver["laps"], ver["cost_time"]) == (3, 0)
    assert nor["straights"][0]["clipping"] == 1.0
    assert nor["straights"][0]["clipped"] > 1500


def test_energy_of_a_missing_lap_is_404(client: TestClient) -> None:
    assert client.get("/api/sessions/2026/1/Q/energy?laps=VER:9").status_code == 404


def test_deploy_on_the_compare_grid(client: TestClient) -> None:
    energy = client.get("/api/sessions/2026/1/Q/energy?laps=NOR:2,VER:fastest&step=5").json()
    # /compare's grid: every 5 m over the first lap's length (the fake laps have no gear/rpm).
    grid = make_grid(CLIPPED.length, 5.0).tolist()
    nor, ver = (row["deploy"] for row in energy["laps"])
    assert len(nor) == len(ver) == len(grid)
    clip_at = energy["laps"][0]["straights"][0]["clip_at"]
    after = [v for d, v in zip(grid, nor, strict=True) if v is not None and d > clip_at + 100]
    assert after and max(after) < 30  # not gaining: far below the best laps
    assert max(v for v in ver if v is not None) > 80
    assert (
        client.get("/api/sessions/2026/1/Q/energy?laps=NOR:2").json()["laps"][0]["deploy"] is None
    )


def test_session_report(client: TestClient) -> None:
    body = client.get("/api/sessions/2026/1/Q/report").json()
    assert body["kind"] == "quali"
    assert body["moments"] == [] and body["long_runs"] == []
    [clip] = body["clipping"]
    assert (clip["driver"], clip["reference"], clip["corner"]) == ("NOR", "VER", "1")
    assert clip["action"]["laps"][1].startswith("NOR:") and clip["action"]["zoom"] is not None
