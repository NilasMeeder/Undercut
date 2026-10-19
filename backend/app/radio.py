"""Team radio: the clips of a session (the archive's team_radio.json, or a live recording's,
converted from F1's TeamRadio topic) and their audio."""

import re
from datetime import datetime

from app import sessions
from app.generations import session_cache
from app.schemas import TeamRadio
from app.sources import tracinginsights as ti

CLIP = re.compile(r"^[A-Za-z0-9_\-]+\.mp3$")
"""A clip's file name; anything else is not served (it becomes part of a cache path)."""


def clips(columns: dict, t0: datetime | None) -> list[TeamRadio]:
    """team_radio.json columns as clips in time order; `id` is the row in the file."""
    out = []
    drivers, dates = columns.get("drv", []), columns.get("date", [])
    for i, (driver, date) in enumerate(zip(drivers, dates, strict=False)):
        if not driver or not date:
            continue
        utc = datetime.fromisoformat(str(date).replace("Z", "+00:00"))
        t = None if t0 is None else round((utc - t0).total_seconds(), 3)
        out.append(TeamRadio(id=i, driver=driver, utc=utc, t=t))
    return sorted(out, key=lambda c: c.utc)


def _columns(year: int, round_number: int, code: str) -> dict:
    event, session = sessions.folders(year, round_number, code)
    try:
        data = ti.fetch_json(year, event, session, "team_radio.json")
    except ti.SourceNotAvailable:
        return {}
    return data if isinstance(data, dict) else {}


@session_cache(maxsize=16)
def get_team_radio(year: int, round_number: int, code: str) -> list[TeamRadio]:
    return clips(_columns(year, round_number, code), sessions.get_t0(year, round_number, code))


def get_audio(year: int, round_number: int, code: str, clip: int) -> bytes:
    columns = _columns(year, round_number, code)
    files = columns.get("file", [])
    if not 0 <= clip < len(files):
        raise LookupError(f"No team radio clip {clip}")
    driver = columns["drv"][clip]
    file = str(files[clip]).rsplit("/", 1)[-1]
    if not CLIP.match(file) or not re.match(r"^[A-Z]{3}$", str(driver)):
        raise LookupError(f"No team radio clip {clip}")
    event, session = sessions.folders(year, round_number, code)
    return ti.fetch_radio(year, event, session, driver, file, str(columns["url"][clip]))
