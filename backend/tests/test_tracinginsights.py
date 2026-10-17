import threading
import time
from pathlib import Path
from typing import Any

import pytest

from app.sources import tracinginsights as ti


class SlowResponse:
    status_code = 200

    def raise_for_status(self) -> None:
        pass

    def json(self) -> Any:
        return {"tel": {"speed": [1, 2, 3]}}


def test_concurrent_fetches_download_once(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    calls = 0

    def slow_get(url: str, timeout: float) -> SlowResponse:
        nonlocal calls
        calls += 1
        time.sleep(0.05)
        return SlowResponse()

    monkeypatch.setattr(ti, "TRACINGINSIGHTS_CACHE_DIR", tmp_path)
    monkeypatch.setattr(ti._http, "get", slow_get)

    results: list[Any] = []
    errors: list[Exception] = []

    def fetch() -> None:
        try:
            results.append(ti.lap_telemetry(2025, "Event", "Qualifying", "VER", 1))
        except Exception as error:
            errors.append(error)

    threads = [threading.Thread(target=fetch) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    assert calls == 1
    assert results == [{"speed": [1, 2, 3]}] * 6
    assert list(tmp_path.rglob("*.tmp")) == []
