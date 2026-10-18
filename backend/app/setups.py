"""Top speed against cornering speed per driver: where each car sits between low drag and high
downforce. From every driver's best lap, all on the session's quickest lap like /compare."""

from dataclasses import dataclass

import numpy as np

from app import analysis, energies, sessions, strategy
from app.generations import session_cache
from app.replay import driven
from app.schemas import (
    Lap,
    SetupDriver,
    SetupMap,
    TeammateCorner,
    TeammatePair,
    Teammates,
)
from app.sources import tracinginsights as ti

SLOW = 150.0
"""km/h: a corner whose minimum on the quickest lap is below this is slow (traction, mechanical
grip); faster ones are where downforce counts."""


def best_laps(laps: list[Lap]) -> list[Lap]:
    """Every driver's quickest lap that counts, quickest first."""
    best: dict[str, Lap] = {}
    for lap in laps:
        if lap.lap_time is None or lap.deleted or not driven(lap):
            continue
        if lap.driver not in best or lap.lap_time < (best[lap.driver].lap_time or 0):
            best[lap.driver] = lap
    return sorted(best.values(), key=lambda lap: lap.lap_time or 0)


def corner_speeds(
    segments: list[analysis.CornerSegment], index: int
) -> tuple[float | None, float | None]:
    """Mean minimum speed of lap `index` in the slow and in the faster corners, split on the
    reference lap's (index 0) minimum."""
    slow = [s.laps[index].min_speed for s in segments if s.laps[0].min_speed < SLOW]
    fast = [s.laps[index].min_speed for s in segments if s.laps[0].min_speed >= SLOW]
    return (
        float(np.mean(slow)) if slow else None,
        float(np.mean(fast)) if fast else None,
    )


@dataclass(frozen=True)
class BestLaps:
    """Every driver's best lap with telemetry of a normal length, quickest first, compared on
    the quickest lap and cut into corner segments."""

    laps: list[Lap]
    traces: list[analysis.LapTrace]
    segments: list[analysis.CornerSegment]


@session_cache(maxsize=4)
def best_lap_corners(year: int, round_number: int, code: str) -> BestLaps:
    ranked = best_laps(sessions.get_laps(year, round_number, code))
    energies.prefetch_laps(year, round_number, code, ranked)
    circuit = sessions.get_circuit(year, round_number, code)
    corners = [(c.label, c.distance) for c in circuit.corners]
    found = []
    for lap in ranked:
        try:
            found.append((lap, sessions.get_trace(year, round_number, code, lap.driver, lap.lap)))
        except ti.SourceNotAvailable:
            continue
    if len(found) < 2:
        return BestLaps([], [], [])
    median = float(np.median([t.length for _, t in found]))
    found = [(lap, t) for lap, t in found if analysis.length_off(t.length, median) is None]
    traces = [t for _, t in found]
    segments = analysis.corner_segments(analysis.compare(traces), corners)
    return BestLaps([lap for lap, _ in found], traces, segments)


@session_cache(maxsize=4)
def setup_map(year: int, round_number: int, code: str) -> SetupMap:
    best = best_lap_corners(year, round_number, code)
    drivers = []
    for i, (lap, trace) in enumerate(zip(best.laps, best.traces, strict=True)):
        slow, fast = corner_speeds(best.segments, i)
        all_min = [s.laps[i].min_speed for s in best.segments]
        drivers.append(
            SetupDriver(
                driver=lap.driver,
                lap=lap.lap,
                lap_time=lap.lap_time or 0.0,
                top_speed=round(float(np.max(trace.channels["speed"])), 1),
                speed_trap=lap.speed_trap,
                corner_speed=round(float(np.mean(all_min)), 1) if all_min else None,
                slow_corners=None if slow is None else round(slow, 1),
                fast_corners=None if fast is None else round(fast, 1),
            )
        )
    return SetupMap(slow_limit=SLOW, drivers=drivers)


def corner_gaps(
    segments: list[analysis.CornerSegment], a: int, b: int
) -> list[tuple[str, float, float]]:
    """Per corner segment (label, start) what lap b loses to lap a there (seconds, + = slower)."""
    return [(s.label, s.start, s.laps[b].time - s.laps[a].time) for s in segments]


def race_pace(laps: list[Lap], driver: str) -> tuple[float | None, int]:
    """Median of a driver's clean race laps, and how many there are."""
    times = [lap.lap_time for lap in laps if lap.driver == driver and strategy.is_clean(lap)]
    clean = [t for t in times if t is not None]
    return (float(np.median(clean)) if clean else None, len(clean))


@session_cache(maxsize=4)
def teammates(year: int, round_number: int, code: str) -> Teammates:
    """Each team's two drivers side by side: best laps, sectors, top speed, where in the corners,
    and in a race the median pace of the clean laps."""
    detail = sessions.get_detail(year, round_number, code)
    laps = sessions.get_laps(year, round_number, code)
    best = best_lap_corners(year, round_number, code)
    index = {lap.driver: i for i, lap in enumerate(best.laps)}
    best_by_driver = {lap.driver: lap for lap in best_laps(laps)}
    race = code in ("R", "S")
    teams: dict[str, list[str]] = {}
    for driver in detail.drivers:
        teams.setdefault(driver.team, []).append(driver.code)
    out = []
    for team, codes in teams.items():
        if len(codes) != 2:
            continue
        # Quicker best lap first; without a lap last.
        codes.sort(key=lambda c: best_by_driver[c].lap_time or 1e9 if c in best_by_driver else 1e9)
        a, b = codes
        la, lb = best_by_driver.get(a), best_by_driver.get(b)
        gap = (
            lb.lap_time - la.lap_time
            if la and lb and la.lap_time is not None and lb.lap_time is not None
            else None
        )
        sectors = []
        for name in ("sector_1", "sector_2", "sector_3"):
            sa = getattr(la, name) if la else None
            sb = getattr(lb, name) if lb else None
            sectors.append(None if sa is None or sb is None else round(sb - sa, 3))
        corners = []
        if a in index and b in index:
            corners = [
                TeammateCorner(label=label, start=round(start, 1), gap=round(g, 3))
                for label, start, g in corner_gaps(best.segments, index[a], index[b])
            ]
        top = None
        if a in index and b in index:
            top = round(
                float(np.max(best.traces[index[b]].channels["speed"]))
                - float(np.max(best.traces[index[a]].channels["speed"])),
                1,
            )
        pace_a, count_a = race_pace(laps, a) if race else (None, 0)
        pace_b, count_b = race_pace(laps, b) if race else (None, 0)
        out.append(
            TeammatePair(
                team=team,
                drivers=[a, b],
                laps=[la.lap if la else None, lb.lap if lb else None],
                best=[la.lap_time if la else None, lb.lap_time if lb else None],
                gap=None if gap is None else round(gap, 3),
                sectors=sectors,
                top_speed=top,
                corners=corners,
                pace=[pace_a, pace_b],
                pace_laps=[count_a, count_b],
            )
        )
    out.sort(key=lambda pair: pair.best[0] or 1e9)
    return Teammates(race=race, teams=out)
