"""Where live timing recordings live: <LIVE_DIR>/<year>/<event>/<session>/ with live.txt (the
feed), meta.json (which session) and converted/ (the feed as the archive's files, made again from
live.txt whenever it is missing or older)."""

import json
from pathlib import Path

from app.config import LIVE_DIR

RECORDING = "live.txt"
CONVERTED = "converted"


def session_dir(year: int, event: str, session: str) -> Path:
    return LIVE_DIR / str(year) / event / session


def recording_path(year: int, event: str, session: str) -> Path:
    return session_dir(year, event, session) / RECORDING


def has_recording(year: int, event: str, session: str) -> bool:
    return recording_path(year, event, session).exists()


def write_meta(year: int, round_number: int, code: str, event: str, session: str) -> Path:
    """Mark the folder as a recording of this session (the service finds recordings by it)."""
    folder = session_dir(year, event, session)
    folder.mkdir(parents=True, exist_ok=True)
    meta = {"year": year, "round": round_number, "code": code}
    (folder / "meta.json").write_text(json.dumps(meta))
    return folder


def converted_dir(year: int, event: str, session: str) -> Path:
    return session_dir(year, event, session) / CONVERTED
