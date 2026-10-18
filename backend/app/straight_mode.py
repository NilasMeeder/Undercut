"""Straight-mode zones (2026) on the lap: the FIA's activation points, ended where the session
brakes.

The zones are not in the data (F1 publishes no aero channel, and the acceleration does not show
the wings opening reliably: see ROADMAP fase 11). The FIA's circuit map per event gives where
straight mode may be switched on, as metres after a corner; `app/sources/fia.py` reads those into
`straight_mode.json`. The table gives no end (the drawing does): the wings close at the end of
the zone or on the brakes, so a zone ends where the straight in Energy ends (most clean laps
brake there) or where the next zone starts. Where the drawing ends it before a flat-out corner
(Spa: Eau Rouge), the JSON has an `end` read off the drawing by hand.
"""

import json
from functools import lru_cache
from typing import Any, Literal

from app import sessions, zones
from app.generations import session_cache
from app.schemas import StraightMode, StraightModeZone, TimeRange, TrackZone
from app.sources import fia
from app.sources import tracinginsights as ti

LEAD_IN = 300.0
"""An activation point this far before a straight starts still belongs to it: the FIA's point
is often on the exit of the corner, where the car is not yet at full throttle (Monza A1)."""
NO_STRAIGHT_BRAKE = 150.0
"""No straight in the data: the zone ends this far before the next corner."""
LOW_GRIP = "LOW GRIP CONDITIONS"
NORMAL_GRIP = "NORMAL GRIP CONDITIONS"


@lru_cache(maxsize=1)
def _maps() -> dict[str, Any]:
    if not fia.ZONES_FILE.exists():
        return {}
    return json.loads(fia.ZONES_FILE.read_text(encoding="utf-8"))


def place(corners: dict[str, float], length: float, point: dict[str, Any] | None) -> float | None:
    """A point "metres after corner" as a distance on the lap (0…length), or None."""
    if point is None or point["corner"] not in corners:
        return None
    return (corners[point["corner"]] + point["metres"]) % length


EndSource = Literal["braking", "next_zone", "drawing", "next_corner"]


def _ahead(start: float, at: float, length: float) -> float:
    """`at` (0…length) as the first distance after `start` (which may be below zero)."""
    while at <= start:
        at += length
    while at - length > start:
        at -= length
    return at


def zone_end(
    start: float,
    straights: list[TrackZone],
    corners: list[float],
    length: float,
    next_start: float | None = None,
    drawn: float | None = None,
) -> tuple[float, float, EndSource]:
    """(start, end, where the end comes from) of a zone from `start` (0…length), on the scale
    of the straight it is on (or just before, LEAD_IN; a start below zero is before the line):
    an end read off the drawing, else where the straight ends (braking) or the next zone starts
    if that is sooner; without a straight NO_STRAIGHT_BRAKE before the next corner."""
    best: tuple[float, float] | None = None
    for straight in straights:
        for at in (start - length, start, start + length):
            if straight.start - LEAD_IN <= at < straight.end and (
                best is None or straight.end - at < best[1] - best[0]
            ):
                best = (at, straight.end)
    source: EndSource
    if best is not None:
        start, end, source = best[0], best[1], "braking"
    else:
        ahead = min((_ahead(start, c, length) for c in corners), default=start + length)
        end, source = max(ahead - NO_STRAIGHT_BRAKE, start), "next_corner"
    if drawn is not None:
        return start, _ahead(start, drawn, length), "drawing"
    if next_start is not None and (other := _ahead(start, next_start, length)) < end:
        return start, other, "next_zone"
    return start, end, source


def low_grip_periods(messages: list[tuple[float, str]]) -> list[TimeRange]:
    """(session time, message) of race control -> the low-grip periods, in order."""
    out: list[TimeRange] = []
    for t, message in sorted(messages):
        text = message.upper()
        if LOW_GRIP in text and (not out or out[-1].end is not None):
            out.append(TimeRange(start=t, end=None))
        elif NORMAL_GRIP in text and out and out[-1].end is None:
            out[-1].end = t
    return out


def _straights(year: int, round_number: int, code: str) -> list[TrackZone]:
    try:
        found = zones.get_zones(year, round_number, code)
    except (ti.SourceNotAvailable, LookupError, ValueError):
        return []
    return found.zones if found.kind == "straight" else []


@session_cache(maxsize=8)
def get_straight_mode(year: int, round_number: int, code: str) -> StraightMode:
    event, _ = sessions.folders(year, round_number, code)
    found = _maps().get(str(year), {}).get(event)
    if not found or not found["zones"]:
        return StraightMode(
            source=found["source"] if found else None, length=0.0, zones=[], low_grip=[]
        )
    circuit = sessions.get_circuit(year, round_number, code)
    length = sessions.typical_lap_length(year, round_number, code) or circuit.lap_length
    scale = length / circuit.lap_length if circuit.lap_length > 0 else 1.0
    corners = {c.label: c.distance * scale for c in circuit.corners}
    straights = _straights(year, round_number, code)
    placed = [
        (z, at) for z in found["zones"] if (at := place(corners, length, z["normal"])) is not None
    ]
    starts = sorted(at for _, at in placed)
    out = []
    for zone, at in placed:
        later = [s for s in starts if s > at] or starts[:1]
        start, end, end_source = zone_end(
            at,
            straights,
            list(corners.values()),
            length,
            next_start=later[0] if len(starts) > 1 else None,
            drawn=place(corners, length, zone.get("end")),
        )
        low = place(corners, length, zone["low_grip"])
        if low is not None:
            # On the same side of the line as the normal start; past the end means no zone.
            low = min((low - length, low, low + length), key=lambda x: abs(x - start))
            low = low if low < end else None
        out.append(
            StraightModeZone(
                label=zone["label"],
                start=round(start, 1),
                end=round(end, 1),
                end_source=end_source,
                activation=zone["normal"]["text"],
                low_grip_start=None if low is None else round(low, 1),
                low_grip_activation=zone["low_grip"]["text"] if zone["low_grip"] else None,
            )
        )
    try:
        messages = sessions.get_race_control(year, round_number, code)
    except (ti.SourceNotAvailable, LookupError, ValueError):
        messages = []
    periods = low_grip_periods(
        [(m.session_time, m.message) for m in messages if m.session_time is not None]
    )
    return StraightMode(
        source=found["source"], length=round(length, 1), zones=out, low_grip=periods
    )
