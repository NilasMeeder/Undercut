from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app, base_url="http://localhost")


def test_health() -> None:
    assert client.get("/api/health").json() == {"status": "ok"}


def test_unsupported_season_returns_404() -> None:
    assert client.get("/api/seasons/2010/events").status_code == 404
