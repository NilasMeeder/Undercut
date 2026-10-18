"""Zones along the track for the map: DRS zones (until 2025) or, from 2026 (no DRS), the straights
at full throttle with where the session usually starts to clip.

DRS zones are not in the data; the flap is. Where most of the quickest laps have it open is a
zone. In a race the flap only opens within a second of another car, so a race takes the zones
from the weekend's qualifying.
"""

import numpy as np

from app import analysis, energies, sessions
from app.generations import session_cache
from app.replay import driven
from app.schemas import Lap, TrackSectors, TrackZone, TrackZones
from app.sources import tracinginsights as ti

DRS_LAPS = 8
"""Best laps of this many drivers (quickest first) vote on where the flap is open."""
DRS_MIN_LAPS = 3
"""Fewer laps with the flap open than this: no zones from this session."""
DRS_SHARE = 0.5
"""A point is in a zone when at least this share of those laps has the flap open there."""
DRS_MIN_LENGTH = 100.0
"""Shorter stretches are a flap opening late or closing early, not a zone."""
LINE_SLACK = 30.0
"""A zone this close to both ends of the lap runs across the line."""
CLIP_SHARE = 0.5
"""A straight shows where the session clips when at least this share of clean laps clips."""
STEP = 5.0

DRS_SOURCES = {"R": ("Q",), "S": ("SQ", "Q"), "SS": ("SQ", "Q")}
"""Sessions where the flap only opens behind another car, and where to take the zones from."""


SECTOR_LAPS = 5
"""Best laps of this many drivers tell where the sectors end."""


Flap = tuple[np.ndarray, np.ndarray]
"""A lap's distance (m) and its DRS flap (1 = open)."""


def drs_zones(laps: list[Flap], length: float) -> list[tuple[float, float]]:
    """(start, end) of the stretches where at least DRS_SHARE of the laps (distance, flap open
    0/1) have the flap open, on a lap of `length`; a zone across the line starts below zero."""
    if len(laps) < DRS_MIN_LAPS or length <= 0:
        return []
    grid = analysis.make_grid(length, STEP)
    votes = np.zeros(grid.size)
    for distance, flap in laps:
        scaled = distance * (length / distance[-1])
        at = np.clip(np.searchsorted(scaled, grid, side="right") - 1, 0, len(scaled) - 1)
        votes += flap[at] >= 1
    inside = votes >= DRS_SHARE * len(laps)
    edges = np.flatnonzero(np.diff(np.concatenate(([0], inside.astype(int), [0]))))
    zones = [
        (float(grid[a]), float(grid[b - 1]))
        for a, b in zip(edges[::2], edges[1::2], strict=True)
        if grid[b - 1] - grid[a] >= DRS_MIN_LENGTH
    ]
    if len(zones) > 1 and zones[0][0] <= LINE_SLACK and zones[-1][1] >= length - LINE_SLACK:
        first, last = zones.pop(0), zones.pop()
        zones.append((last[0] - length, first[1]))
        zones.sort()
    return zones


def _best_laps(laps: list[Lap], count: int) -> list[Lap]:
    best: dict[str, Lap] = {}
    for lap in laps:
        if lap.lap_time is None or lap.deleted or not driven(lap):
            continue
        if lap.driver not in best or lap.lap_time < best[lap.driver].lap_time:  # type: ignore[operator]
            best[lap.driver] = lap
    return sorted(best.values(), key=lambda lap: lap.lap_time or 0)[:count]


def _flap_laps(year: int, round_number: int, code: str) -> list[Flap]:
    out = []
    try:
        laps = sessions.get_laps(year, round_number, code)
    except (ti.SourceNotAvailable, LookupError, ValueError):
        return []
    for lap in _best_laps(laps, DRS_LAPS):
        try:
            trace = sessions.get_trace(year, round_number, code, lap.driver, lap.lap)
        except ti.SourceNotAvailable:
            continue
        flap = trace.channels.get("drs")
        if flap is not None and len(trace.distance) > 1 and np.any(flap >= 1):
            out.append((trace.distance, flap))
    return out


def _drs(year: int, round_number: int, code: str, length: float) -> TrackZones:
    for source in (code, *DRS_SOURCES.get(code, ())):
        if source in DRS_SOURCES:
            continue  # a race on its own says little: the flap opens behind another car only
        zones = drs_zones(_flap_laps(year, round_number, source), length)
        if zones:
            return TrackZones(
                kind="drs",
                source=source,
                zones=[
                    TrackZone(label=f"DRS {i}", start=round(a, 1), end=round(b, 1))
                    for i, (a, b) in enumerate(zones, start=1)
                ],
            )
    return TrackZones(kind="none", source=None, zones=[])


def _straights(year: int, round_number: int, code: str) -> TrackZones:
    result = energies.get_session(year, round_number, code)
    zones = []
    for corner in result.order:
        rows = [laps[corner] for laps in result.laps.values() if corner in laps]
        if not rows:
            continue
        clips = [r.clip_at for r in rows if r.clip_at is not None]
        share = len(clips) / len(rows)
        zones.append(
            TrackZone(
                label=f"T{result.after[corner]} → T{corner}",
                corner=corner,
                start=round(float(np.median([r.start for r in rows])), 1),
                end=round(float(np.median([r.end for r in rows])), 1),
                clip_at=round(float(np.median(clips)), 1) if share >= CLIP_SHARE else None,
                clipping=round(share, 3),
            )
        )
    return TrackZones(kind="straight", source=code, zones=zones)


@session_cache(maxsize=8)
def get_zones(year: int, round_number: int, code: str) -> TrackZones:
    if not sessions.has_drs(year):
        return _straights(year, round_number, code)
    length = sessions.typical_lap_length(year, round_number, code)
    return _drs(year, round_number, code, length) if length else TrackZones(kind="none", zones=[])


SectorLap = tuple[np.ndarray, np.ndarray, float, float]
"""A lap's distance (m) and time into the lap (s) per sample, and its sector 1 and 2 times."""


def sector_bounds(laps: list[SectorLap], length: float) -> list[float]:
    """Where sector 1 and 2 end on a lap of `length`: per lap the distance at the end of each
    sector as a share of the lap, the median over the laps."""
    shares: list[tuple[float, float]] = []
    for distance, time, s1, s2 in laps:
        if len(distance) < 2 or distance[-1] <= 0 or s1 + s2 >= time[-1]:
            continue
        at = np.interp([s1, s1 + s2], time, distance) / distance[-1]
        shares.append((float(at[0]), float(at[1])))
    if not shares or length <= 0:
        return []
    return [round(float(np.median(column)) * length, 1) for column in zip(*shares, strict=True)]


@session_cache(maxsize=8)
def get_sectors(year: int, round_number: int, code: str) -> TrackSectors:
    timed = [
        lap
        for lap in sessions.get_laps(year, round_number, code)
        if lap.sector_1 is not None and lap.sector_2 is not None
    ]
    laps: list[SectorLap] = []
    for lap in _best_laps(timed, SECTOR_LAPS):
        try:
            trace = sessions.get_trace(year, round_number, code, lap.driver, lap.lap)
        except ti.SourceNotAvailable:
            continue
        assert lap.sector_1 is not None and lap.sector_2 is not None
        laps.append((trace.distance, trace.time, lap.sector_1, lap.sector_2))
    length = sessions.get_circuit(year, round_number, code).lap_length
    return TrackSectors(boundaries=sector_bounds(laps, length))
