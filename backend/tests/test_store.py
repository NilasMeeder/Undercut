"""Markers and saved views through the API, on a fresh SQLite file per test."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import config
from app.main import app

MARKERS = "/api/sessions/2025/16/Q/markers"


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[TestClient]:
    monkeypatch.setattr(config, "DATABASE_PATH", tmp_path / "sub" / "test.db")
    with TestClient(app, base_url="http://localhost") as test_client:
        yield test_client


def test_marker_lifecycle(client: TestClient) -> None:
    assert client.get(MARKERS).json() == []
    body = {
        "kind": "distance",
        "start": 820.0,
        "end": 950.5,
        "driver": "VER",
        "lap": 17,
        "note": "Late on the brakes",
        "tags": [" lock-up ", "Lock-Up", "T1", ""],
    }
    created = client.post(MARKERS, json=body)
    assert created.status_code == 201
    marker = created.json()
    assert marker["tags"] == ["lock-up", "T1"]  # trimmed, deduplicated ignoring case
    assert (marker["year"], marker["round"], marker["session"]) == (2025, 16, "Q")

    moment = client.post(MARKERS, json={"kind": "time", "start": 3600.0}).json()
    assert moment["end"] is None and moment["note"] == "" and moment["tags"] == []

    listed = client.get(MARKERS).json()
    assert [m["kind"] for m in listed] == ["distance", "time"]
    assert client.get("/api/sessions/2025/16/R/markers").json() == []

    updated = client.put(f"/api/markers/{marker['id']}", json={**body, "note": "Lift and coast"})
    assert updated.json()["note"] == "Lift and coast"
    assert client.get("/api/markers/tags").json() == [
        {"tag": "lock-up", "count": 1},
        {"tag": "T1", "count": 1},
    ]

    assert client.delete(f"/api/markers/{marker['id']}").status_code == 204
    assert client.delete(f"/api/markers/{marker['id']}").status_code == 404
    assert client.put(f"/api/markers/{marker['id']}", json=body).status_code == 404
    assert [m["id"] for m in client.get(MARKERS).json()] == [moment["id"]]


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "distance", "start": 500.0, "end": 400.0},  # end before start
        {"kind": "distance", "start": -5.0},
        {"kind": "distance", "start": 5.0, "lap": 3},  # a lap without a driver
        {"kind": "distance", "start": 5.0, "driver": "ver"},
        {"kind": "lap", "start": 5.0},
        {"kind": "time", "start": 5.0, "tags": [str(i) for i in range(13)]},
    ],
)
def test_invalid_markers_are_rejected(client: TestClient, body: dict) -> None:
    assert client.post(MARKERS, json=body).status_code == 422


def test_view_lifecycle(client: TestClient) -> None:
    state = {
        "laps": {"blue": [{"driver": "VER", "lap": 17}, {"driver": "NOR", "lap": 20}]},
        "zoom": {"blue": [800.0, 1200.0]},
        "clock": 4321.5,
        "layout": {"grid": {"root": {}}, "panels": {"p1": {"contentComponent": "laps"}}},
        "preset": "quali-duel",
    }
    body = {"name": "Q3 duel", "year": 2025, "round": 16, "session": "Q", "state": state}
    view = client.post("/api/views", json=body).json()
    assert view["state"] == state

    second = client.post("/api/views", json={**body, "name": "Race", "session": "R"}).json()
    renamed = client.put(f"/api/views/{view['id']}", json={**body, "name": "Q3: VER vs NOR"})
    assert renamed.json()["name"] == "Q3: VER vs NOR"
    # Most recently updated first.
    assert [v["id"] for v in client.get("/api/views").json()] == [view["id"], second["id"]]

    assert client.post("/api/views", json={**body, "name": ""}).status_code == 422
    assert client.delete(f"/api/views/{second['id']}").status_code == 204
    assert client.delete(f"/api/views/{second['id']}").status_code == 404
    assert [v["name"] for v in client.get("/api/views").json()] == ["Q3: VER vs NOR"]
