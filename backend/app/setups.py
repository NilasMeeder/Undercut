"""Top speed against cornering speed per driver: where each car sits between low drag and high
downforce. From every driver's best lap, all on the session's quickest lap like /compare."""

import numpy as np

from app import analysis, energies, sessions
from app.generations import session_cache
from app.replay import driven
from app.schemas import Lap, SetupDriver, SetupMap
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


@session_cache(maxsize=4)
def setup_map(year: int, round_number: int, code: str) -> SetupMap:
    ranked = best_laps(sessions.get_laps(year, round_number, code))
    energies.prefetch_laps(year, round_number, code, ranked)
    circuit = sessions.get_circuit(year, round_number, code)
    corners = [(c.label, c.distance) for c in circuit.corners]
    traces = []
    for lap in ranked:
        try:
            traces.append((lap, sessions.get_trace(year, round_number, code, lap.driver, lap.lap)))
        except ti.SourceNotAvailable:
            continue
    if len(traces) < 2:
        return SetupMap(slow_limit=SLOW, drivers=[])
    median = float(np.median([t.length for _, t in traces]))
    traces = [(lap, t) for lap, t in traces if analysis.length_off(t.length, median) is None]
    comparison = analysis.compare([t for _, t in traces])
    segments = analysis.corner_segments(comparison, corners)
    drivers = []
    for i, (lap, trace) in enumerate(traces):
        slow, fast = corner_speeds(segments, i)
        all_min = [s.laps[i].min_speed for s in segments]
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
