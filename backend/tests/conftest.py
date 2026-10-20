import pytest

from app import config


@pytest.fixture(autouse=True)
def _own_live_dir(
    monkeypatch: pytest.MonkeyPatch, tmp_path_factory: pytest.TempPathFactory
) -> None:
    """Never the real recordings folder: with its auto.json a test backend would start the real
    recorder (recorder.resume)."""
    monkeypatch.setattr(config, "LIVE_DIR", tmp_path_factory.mktemp("live"))
