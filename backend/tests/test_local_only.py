"""Only pages on localhost reach the API: no DNS rebinding, no blind POSTs from other sites."""

from fastapi.testclient import TestClient

from app.local_only import allowed
from app.main import app


def test_hosts() -> None:
    assert allowed("GET", "localhost:8000", None)
    assert allowed("GET", "127.0.0.1:8000", None)
    assert allowed("GET", "[::1]:8000", None)
    assert not allowed("GET", "evil.example:8000", None)  # rebound to 127.0.0.1
    assert not allowed("GET", None, None)


def test_changing_requests_from_other_sites() -> None:
    assert allowed("POST", "localhost:8000", None)  # curl
    assert allowed("POST", "localhost:5173", "http://localhost:5173")  # the Vite proxy
    assert allowed("DELETE", "localhost:8000", "http://127.0.0.1:5175")
    assert not allowed("POST", "localhost:8000", "https://evil.example")
    assert not allowed("POST", "localhost:8000", "null")  # a sandboxed page
    assert allowed("GET", "localhost:8000", "https://evil.example")  # cannot read it: no CORS


def test_the_app_refuses_them() -> None:
    local = TestClient(app, base_url="http://localhost")
    assert local.get("/api/health").status_code == 200
    blind = local.post("/api/live/recorder", headers={"Origin": "https://evil.example"})
    assert blind.status_code == 403
    rebound = TestClient(app, base_url="http://evil.example")
    assert rebound.get("/api/health").status_code == 403
