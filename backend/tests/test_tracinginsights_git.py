"""The git bulk path against a local 'remote' repo (file://), so it runs without network."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.sources import tracinginsights_git as ti_git

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")


def git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


@pytest.fixture
def remote(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    src = tmp_path / "remote"
    folder = src / "Test Grand Prix" / "Race"
    for driver, laps in (("VER", 3), ("NOR", 2)):
        (folder / driver).mkdir(parents=True)
        for lap in range(1, laps + 1):
            tel = {"tel": {"time": [0.0, lap], "driver": driver}}
            (folder / driver / f"{lap}_tel.json").write_text(json.dumps(tel))
    git(src, "init", "-q", "-b", "main")
    git(src, "add", ".")
    git(src, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "data")
    # What GitHub allows and a local repo does not by default: filtered clones, fetching by id.
    git(src, "config", "uploadpack.allowFilter", "true")
    git(src, "config", "uploadpack.allowAnySHA1InWant", "true")

    monkeypatch.setattr(ti_git, "REPO_URL", f"file://{src}")
    monkeypatch.setattr(ti_git, "TRACINGINSIGHTS_CACHE_DIR", tmp_path / "cache")
    return src


def test_prefetch_delivers_files_and_reports_missing(remote: Path) -> None:
    received: dict[str, dict] = {}
    progress: list[float] = []
    absent = ti_git.prefetch(
        2025,
        "Test Grand Prix/Race",
        ["VER/1_tel.json", "VER/3_tel.json", "NOR/2_tel.json", "NOR/9_tel.json"],
        progress.append,
        lambda file, raw: received.__setitem__(file, json.loads(raw)),
    )
    assert absent == {"NOR/9_tel.json"}
    assert set(received) == {"VER/1_tel.json", "VER/3_tel.json", "NOR/2_tel.json"}
    assert received["VER/3_tel.json"]["tel"] == {"time": [0.0, 3], "driver": "VER"}
    assert progress[-1] == 1.0
    assert progress == sorted(progress)


def test_prefetch_deletes_the_fetched_pack(remote: Path) -> None:
    def fetch() -> None:
        ti_git.prefetch(2025, "Test Grand Prix/Race", ["VER/1_tel.json"], lambda _: None, print)

    fetch()
    packs = ti_git._packs(ti_git._repo(2025))
    fetch()
    assert ti_git._packs(ti_git._repo(2025)) == packs


def test_unknown_folder_is_absent(remote: Path) -> None:
    files = ["VER/1_tel.json"]
    absent = ti_git.prefetch(2025, "Other Grand Prix/Race", files, lambda _: None, print)
    assert absent == set(files)
