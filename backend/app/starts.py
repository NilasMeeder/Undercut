"""The race start from each car's first-lap telemetry: where it stood on the grid, when it
passed points 100–500 m past the pole slot, and how quickly it got to 100 and 200 km/h.

Telemetry is ~4 Hz, so every time here is ±0.25 s and a reaction time is not measurable. Each
lap's distance comes from its own speed, so over the first 500 m it is good to a few metres;
the grid slot comes from the car's x/y before it moved, projected onto the circuit outline
(within a few metres; places are 8 m apart).
"""

import numpy as np

from app import energies, replays, sessions
from app.analysis import LapTrace
from app.generations import session_cache
from app.live.track import Outline
from app.schemas import Lap, StartCar, Starts
from app.sources import tracinginsights as ti

CHECKPOINTS = (100.0, 200.0, 300.0, 400.0, 500.0)
"""Metres past the pole sitter's grid slot."""
MOVING = 1.0
"""km/h from which a car has moved off."""
PIT_LANE_DELAY = 3.0
"""Seconds after the field from which a car moving off started from the pit lane."""


def grid_slot(trace: LapTrace, outline: Outline) -> float | None:
    """Metres past the line where the car stood before it moved (negative = before the line)."""
    x, y, speed = trace.channels.get("x"), trace.channels.get("y"), trace.channels.get("speed")
    if x is None or y is None or speed is None or not (speed >= MOVING).any():
        return None  # no car data (the archive has laps with positions but speed 0)
    k = max(int(np.argmax(speed >= MOVING)), 1)
    known = np.isfinite(x[:k]) & np.isfinite(y[:k])
    if not known.any():
        return None
    d = outline.fraction(x[:k][known], y[:k][known]) * outline.length
    d = np.where(d > outline.length / 2, d - outline.length, d)
    return float(np.median(d))


def moved_off(trace: LapTrace) -> float | None:
    speed = trace.channels.get("speed")
    if speed is None or not (speed >= MOVING).any():
        return None
    return float(trace.time[int(np.argmax(speed >= MOVING))])


def time_at(trace: LapTrace, offset: float, target: float) -> float | None:
    """Seconds into the lap at which the car is `target` m from its own start, interpolated."""
    d = trace.distance + offset
    i = int(np.searchsorted(d, target, side="left"))
    if i == 0 or i >= len(d):
        return None
    d0, d1 = d[i - 1], d[i]
    t0, t1 = trace.time[i - 1], trace.time[i]
    return float(t0 + (t1 - t0) * (target - d0) / (d1 - d0)) if d1 > d0 else float(t1)


def time_to(trace: LapTrace, kmh: float) -> float | None:
    speed = trace.channels.get("speed")
    if speed is None or not (speed >= kmh).any():
        return None
    i = int(np.argmax(speed >= kmh))
    if i == 0:
        return float(trace.time[0])
    s0, s1 = speed[i - 1], speed[i]
    t0, t1 = trace.time[i - 1], trace.time[i]
    return float(t0 + (t1 - t0) * (kmh - s0) / (s1 - s0)) if s1 > s0 else float(t1)


def analyse(
    traces: dict[str, LapTrace],
    slots: dict[str, float | None],
    grid: dict[str, int],
    lap_1: dict[str, Lap],
    lights_out: float,
    checkpoints: tuple[float, ...] = CHECKPOINTS,
) -> Starts:
    """Every car's start. A car without a slot (no positions) stands 8 m per place behind pole;
    one that moved off PIT_LANE_DELAY s after the field started from the pit lane (not timed)."""
    moves = {d: m for d, tr in traces.items() if (m := moved_off(tr)) is not None}
    field = float(np.median(list(moves.values()))) if moves else 0.0
    pit_lane = {d for d, m in moves.items() if m > field + PIT_LANE_DELAY}
    on_grid = {d: s for d, s in slots.items() if s is not None and d not in pit_lane}
    pole_driver = min(grid, key=lambda d: grid[d]) if grid else None
    if pole_driver in on_grid:
        pole = on_grid[pole_driver]
    elif on_grid:
        pole = max(on_grid.values())
    else:
        pole = 0.0
    behind: dict[str, float | None] = {}
    for driver in traces:
        if driver in pit_lane or driver not in moves:
            behind[driver] = None
        elif driver in on_grid:
            behind[driver] = pole - on_grid[driver]
        elif driver in grid:
            behind[driver] = 8.0 * (grid[driver] - 1)
        else:
            behind[driver] = None
    times: dict[str, list[float | None]] = {}
    speeds: dict[str, float | None] = {}
    for driver, trace in traces.items():
        if behind[driver] is None:
            # A pit-lane start runs another line to the checkpoints: not timed.
            times[driver] = [None] * len(checkpoints)
            speeds[driver] = None
            continue
        times[driver] = [time_at(trace, -behind[driver], c) for c in checkpoints]
        last = times[driver][-1]
        speed = trace.channels.get("speed")
        speeds[driver] = (
            None
            if last is None or speed is None
            else float(np.max(speed[: int(np.searchsorted(trace.time, last)) + 1]))
        )
    positions: dict[str, list[int | None]] = {d: [] for d in traces}
    for k in range(len(checkpoints)):
        passed = sorted((t[k], d) for d, t in times.items() if t[k] is not None)
        place = {d: i + 1 for i, (_, d) in enumerate(passed)}
        for d in traces:
            positions[d].append(place.get(d))
    cars = [
        StartCar(
            driver=driver,
            grid=grid.get(driver),
            slot=None if behind[driver] is None else round(behind[driver], 1),
            pit_lane=driver in pit_lane,
            times=[None if t is None else round(t, 2) for t in times[driver]],
            positions=positions[driver],
            speed=None if speeds[driver] is None else round(speeds[driver], 0),
            moved=driver in moves,
            to_100=_rounded(time_to(trace, 100.0)),
            to_200=_rounded(time_to(trace, 200.0)),
            lap_1=lap_1[driver].position if driver in lap_1 else None,
            lap_1_end=lap_1[driver].end_time if driver in lap_1 else None,
        )
        for driver, trace in traces.items()
    ]
    cars.sort(key=lambda c: (c.positions[-1] is None, c.positions[-1] or 0, c.grid or 99))
    return Starts(lights_out=lights_out, checkpoints=list(checkpoints), cars=cars)


def _rounded(value: float | None) -> float | None:
    return None if value is None else round(value, 2)


@session_cache(maxsize=8)
def get_starts(year: int, round_number: int, code: str) -> Starts:
    if code not in ("R", "S"):
        raise LookupError("Starts are for races and sprints")
    laps = sessions.get_laps(year, round_number, code)
    lap_1 = {lap.driver: lap for lap in laps if lap.lap == 1 and lap.start_time is not None}
    if not lap_1:
        raise LookupError("No first lap yet")
    lights_out = float(np.median([lap.start_time for lap in lap_1.values()]))
    circuit = sessions.get_circuit(year, round_number, code)
    outline = Outline(
        x=np.asarray(circuit.track_x, dtype=float),
        y=np.asarray(circuit.track_y, dtype=float),
        distance=np.asarray(circuit.track_distance, dtype=float),
        length=circuit.lap_length,
    )
    energies.prefetch_laps(year, round_number, code, [lap_1[d] for d in sorted(lap_1)])
    traces: dict[str, LapTrace] = {}
    for driver in lap_1:
        try:
            traces[driver] = sessions.get_trace(year, round_number, code, driver, 1)
        except ti.SourceNotAvailable:
            continue
    if not traces:
        raise LookupError("No first-lap telemetry yet")
    slots = {d: grid_slot(tr, outline) for d, tr in traces.items()}
    return analyse(
        traces, slots, replays.starting_grid(year, round_number, code), lap_1, lights_out
    )
