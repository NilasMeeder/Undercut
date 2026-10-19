"""Overtake mode (2026, races): who was within 1 s of the car ahead at the detection line.

The FIA's circuit map gives one detection and one activation line per lap (`straight_mode.json`,
read by `app/sources/fia.py`); race control says when overtake mode is enabled. The feed has no
overtake channel, so the passages come from the position track (4 Hz, the replay's): where each
car's lap progress crosses the detection line's share of the lap, interpolated. The gap is to
whichever car crossed it last before (also a lapped car, as with DRS). An estimate: the official
check is a timing loop, this is within a few hundredths where the track is clean.
"""

from dataclasses import dataclass

import numpy as np

from app import replays, straight_mode
from app.generations import session_cache
from app.replay import Track
from app.schemas import OvertakeCheck, OvertakeChecks, TimeRange

WINDOW = 1.0
"""Within this many seconds of the car ahead at the detection line."""
RACES = ("R", "S")


@dataclass(frozen=True)
class Passage:
    driver: str
    lap: int
    """The lap the car is on when it crosses."""
    time: float


def passages(track: Track, fraction: float) -> list[Passage]:
    """Every crossing of the line at `fraction` (0…1) of the lap, in time order."""
    out = []
    for driver, progress in zip(track.drivers, track.progress, strict=True):
        q = np.asarray(progress, dtype=float) - fraction
        a, b = q[:-1], q[1:]
        # Both samples known, and a whole number of laps (past the line) lies between them.
        crossing = np.isfinite(a) & np.isfinite(b) & (np.floor(b) > np.floor(a)) & (b - a < 0.5)
        for i in np.flatnonzero(crossing):
            whole = np.floor(b[i])
            if whole < 0:
                continue  # on the grid, before the first lap
            share = (whole - a[i]) / (b[i] - a[i])
            time = track.start + track.step * (i + share)
            out.append(Passage(driver=driver, lap=int(whole) + 1, time=float(time)))
    return sorted(out, key=lambda p: p.time)


def _enabled_at(periods: list[TimeRange], t: float) -> bool:
    return any(p.start <= t and (p.end is None or t < p.end) for p in periods)


def checks(found: list[Passage], enabled: list[TimeRange]) -> list[OvertakeCheck]:
    """Per passage the gap to the car that crossed before it, and whether that gives overtake
    mode: enabled by race control and within WINDOW."""
    out = []
    previous: Passage | None = None
    for passage in found:
        ahead = previous if previous is not None and previous.driver != passage.driver else None
        gap = None if ahead is None else passage.time - ahead.time
        on = _enabled_at(enabled, passage.time)
        out.append(
            OvertakeCheck(
                driver=passage.driver,
                lap=passage.lap,
                time=round(passage.time, 3),
                ahead=None if ahead is None else ahead.driver,
                gap=None if gap is None else round(gap, 3),
                enabled=on,
                within=gap is not None and gap <= WINDOW,
            )
        )
        previous = passage
    return out


@session_cache(maxsize=8)
def get_checks(year: int, round_number: int, code: str) -> OvertakeChecks:
    mode = straight_mode.get_straight_mode(year, round_number, code)
    if mode.overtake is None or mode.length <= 0 or code not in RACES:
        return OvertakeChecks(detection=None, checks=[])
    track = replays.position_track(year, round_number, code)
    found = passages(track, mode.overtake.detection / mode.length)
    return OvertakeChecks(
        detection=mode.overtake.detection, checks=checks(found, mode.overtake_enabled)
    )
