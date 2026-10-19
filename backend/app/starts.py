"""The race start from each car's first-lap telemetry: where it stood on the grid, when it
passed points 100–500 m past the pole slot, and how quickly it got to 100 and 200 km/h.

Telemetry is ~4 Hz, so every time here is ±0.25 s and a reaction time is not measurable. Each
lap's distance comes from its own speed, so over the first 500 m it is good to a few metres;
the grid slot comes from the car's x/y before it moved, projected onto the circuit outline
(within a few metres; places are 8 m apart).

A standing restart after a red flag is measured the same way, from a window of telemetry around
its lights out (that moment is not in the data: it is where the field moves off together, less
the field's reaction at the race start). The grid is then the order the cars stood in.
"""

import numpy as np

from app import energies, replays, sessions
from app.analysis import LapTrace
from app.generations import session_cache
from app.live.track import Outline
from app.schemas import Lap, RaceControlMessage, StartCar, Starts
from app.sources import tracinginsights as ti

CHECKPOINTS = (100.0, 200.0, 300.0, 400.0, 500.0)
"""Metres past the pole sitter's grid slot."""
MOVING = 1.0
"""km/h from which a car has moved off."""
PITCH = 8.0
"""Metres from one grid slot to the next."""
SLOT_SLACK = 12.0
"""Metres a slot may be off its place on the grid (1.5 places) before it counts as wrong."""
OFF_TRACK = 250.0
"""Decimetres from the outline beyond which a position is not on the grid (Monaco 2026 R has
x/y at 0 before lap 1, and samples interpolated from there)."""
PIT_LANE_DELAY = 3.0
"""Seconds after the field from which a car moving off started from the pit lane."""
STILL = 3.0
"""Seconds a car stands still on the grid before a standing start."""
TOGETHER = 2.0
"""Seconds within which the field moves off at a standing start (pit exits come one by one)."""
FIELD_SHARE = 0.6
"""Share of the cars that must move off together for a standing start."""
REACTION = 0.4
"""Seconds from lights out to the first moving sample when the race start does not tell."""
RESTART_SEARCH = 900.0
"""Seconds after the last 'STANDING START' message of a suspension to look for the start."""
BEFORE, AFTER = 30.0, 90.0
"""Seconds of telemetry before and after a restart's lights out."""
FIRST_LAP_AFTER = 30.0
"""A restart's first lap is the first one a car completes this long after lights out."""


def grid_slot(trace: LapTrace, outline: Outline) -> float | None:
    """Metres past the line where the car stood before it moved (negative = before the line)."""
    x, y, speed = trace.channels.get("x"), trace.channels.get("y"), trace.channels.get("speed")
    if x is None or y is None or speed is None or not (speed >= MOVING).any():
        return None  # no car data (the archive has laps with positions but speed 0)
    k = max(int(np.argmax(speed >= MOVING)), 1)
    known = np.isfinite(x[:k]) & np.isfinite(y[:k])
    if not known.any():
        return None
    fraction, off = outline.project(x[:k][known], y[:k][known])
    if not (off <= OFF_TRACK).any():
        return None
    d = fraction[off <= OFF_TRACK] * outline.length
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
    grid: dict[str, int] | None,
    lap_1: dict[str, Lap],
    lights_out: float,
    checkpoints: tuple[float, ...] = CHECKPOINTS,
    lap: int = 1,
    order: dict[str, int] | None = None,
) -> Starts:
    """Every car's start. A car without a slot (no positions) stands PITCH m per place behind pole;
    one that moved off PIT_LANE_DELAY s after the field started from the pit lane (not timed).
    Without a grid (a restart) the order the cars stand in is the grid, then the cars without
    a slot in `order` (their places before the start); `lap_1` is then the first lap after the
    start and `lap` its number."""
    moves = {d: m for d, tr in traces.items() if (m := moved_off(tr)) is not None}
    field = float(np.median(list(moves.values()))) if moves else 0.0
    pit_lane = {d for d, m in moves.items() if m > field + PIT_LANE_DELAY}
    on_grid = {d: s for d, s in slots.items() if s is not None and d not in pit_lane}
    if grid is None:
        ranked = sorted(on_grid, key=lambda d: -on_grid[d])
        rest = (d for d in order or {} if d in moves and d not in on_grid and d not in pit_lane)
        ranked += sorted(rest, key=lambda d: (order or {})[d])
        grid = {d: i + 1 for i, d in enumerate(ranked)}
    # Where pole is by every car's slot and place; a slot far from its place is a bad position
    # (x/y interpolated from nothing), and the car stands at its place instead.
    poles = [s + PITCH * (grid[d] - 1) for d, s in on_grid.items() if d in grid]
    pole = float(np.median(poles)) if poles else max(on_grid.values(), default=0.0)
    on_grid = {
        d: s
        for d, s in on_grid.items()
        if d not in grid or abs(pole - PITCH * (grid[d] - 1) - s) <= SLOT_SLACK
    }
    pole_driver = min(grid, key=lambda d: grid[d]) if grid else None
    if pole_driver in on_grid:
        pole = on_grid[pole_driver]
    behind: dict[str, float | None] = {}
    for driver in traces:
        if driver in pit_lane or driver not in moves:
            behind[driver] = None
        elif driver in on_grid:
            behind[driver] = pole - on_grid[driver]
        elif driver in grid:
            behind[driver] = PITCH * (grid[driver] - 1)
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
    return Starts(
        lights_out=lights_out, lap=lap, restart=lap > 1, checkpoints=list(checkpoints), cars=cars
    )


def _rounded(value: float | None) -> float | None:
    return None if value is None else round(value, 2)


def move_offs(trace: LapTrace) -> list[float]:
    """Times (of the trace) at which the car moved off after standing still for STILL s."""
    speed = trace.channels.get("speed")
    if speed is None or len(speed) < 2:
        return []
    moving = speed >= MOVING
    out = []
    for k in np.flatnonzero(~moving[:-1] & moving[1:]) + 1:
        before = np.flatnonzero(moving[:k])
        still_from = trace.time[before[-1] + 1] if len(before) else trace.time[0]
        if trace.time[k - 1] - still_from >= STILL:
            out.append(float(trace.time[k]))
    return out


def standing_start(moves: dict[str, list[float]]) -> float | None:
    """The last moment FIELD_SHARE of the cars moved off within TOGETHER s of each other (the
    median of their first moving samples): a standing start. Pit exits come one by one; an
    aborted start is followed by another one."""
    if not moves:
        return None
    best: tuple[float, int] | None = None
    for t in sorted(m for ms in moves.values() for m in ms):
        together = [m for ms in moves.values() for m in ms if t <= m <= t + TOGETHER]
        cars = sum(any(t <= m <= t + TOGETHER for m in ms) for ms in moves.values())
        if cars < FIELD_SHARE * len(moves):
            continue
        if best is None or t > best[0] + TOGETHER or cars > best[1]:
            best = (float(np.median(together)), cars)
    return None if best is None else best[0]


def joined(parts: list[tuple[float, LapTrace]]) -> LapTrace:
    """Consecutive laps (with their start times) as one trace: time in session time, distance
    running on."""
    keys = set.intersection(*(set(trace.channels) for _, trace in parts))
    offsets = np.cumsum([0.0] + [trace.length for _, trace in parts[:-1]])
    return LapTrace(
        distance=np.concatenate(
            [tr.distance + off for (_, tr), off in zip(parts, offsets, strict=True)]
        ),
        time=np.concatenate([start + tr.time for start, tr in parts]),
        channels={k: np.concatenate([tr.channels[k] for _, tr in parts]) for k in keys},
    )


def from_lights_out(trace: LapTrace, lights_out: float) -> LapTrace:
    """A joined trace from where the car stood before it moved off (at most BEFORE s before
    lights out) to AFTER s after: time from lights out, distance from where it stood."""
    speed = trace.channels["speed"]
    t = trace.time
    first = int(np.searchsorted(t, lights_out - BEFORE))
    last = int(np.searchsorted(t, lights_out + AFTER, side="right"))
    soon = np.flatnonzero((t[first:last] >= lights_out - TOGETHER) & (speed[first:last] >= MOVING))
    if len(soon):
        k = first + int(soon[0])
        moving = np.flatnonzero(speed[first:k] >= MOVING)
        first = first + int(moving[-1]) + 1 if len(moving) else first
    if first >= last:  # retired before the restart
        return LapTrace(distance=np.zeros(0), time=np.zeros(0), channels={})
    return LapTrace(
        distance=trace.distance[first:last] - trace.distance[first],
        time=t[first:last] - lights_out,
        channels={k: v[first:last] for k, v in trace.channels.items()},
    )


def suspensions(messages: list[RaceControlMessage]) -> list[tuple[float, float]]:
    """(red flag, last 'STANDING START' message) per suspension resumed with a standing start."""
    reds = sorted(
        m.session_time
        for m in messages
        if (m.flag == "RED" or m.message.upper().startswith("RED FLAG")) and m.session_time
    )
    out = []
    for i, red in enumerate(reds):
        until = reds[i + 1] if i + 1 < len(reds) else float("inf")
        calls = [
            m.session_time
            for m in messages
            if "STANDING START" in m.message.upper()
            and m.session_time is not None
            and red < m.session_time < until
        ]
        if calls:
            out.append((red, max(calls)))
    return out


def outline_of(year: int, round_number: int, code: str) -> Outline:
    circuit = sessions.get_circuit(year, round_number, code)
    return Outline(
        x=np.asarray(circuit.track_x, dtype=float),
        y=np.asarray(circuit.track_y, dtype=float),
        distance=np.asarray(circuit.track_distance, dtype=float),
        length=circuit.lap_length,
    )


def restart(
    year: int,
    round_number: int,
    code: str,
    laps: list[Lap],
    red: float,
    called: float,
    reaction: float,
    outline: Outline,
) -> Starts | None:
    """The standing restart after the red flag at `red`, or None if it has not happened."""
    window = [
        lap
        for lap in laps
        if lap.start_time is not None
        and lap.end_time is not None
        and lap.end_time > red
        and lap.start_time < called + RESTART_SEARCH
    ]
    energies.prefetch_laps(year, round_number, code, window)
    traces: dict[str, LapTrace] = {}
    for driver in sorted({lap.driver for lap in window}):
        parts = []
        for lap in sorted((x for x in window if x.driver == driver), key=lambda x: x.lap):
            try:
                parts.append(
                    (lap.start_time, sessions.get_trace(year, round_number, code, driver, lap.lap))
                )
            except ti.SourceNotAvailable:
                continue
        if parts:
            traces[driver] = joined(parts)  # type: ignore[arg-type]
    moves = {d: [m for m in move_offs(tr) if m > red] for d, tr in traces.items()}
    together = standing_start({d: m for d, m in moves.items() if m})
    if together is None:
        return None
    lights_out = together - reaction
    after = {d: from_lights_out(tr, lights_out) for d, tr in traces.items()}
    after = {d: tr for d, tr in after.items() if len(tr.time) > 1}
    order = {
        lap.driver: lap.position
        for lap in sorted(laps, key=lambda x: x.lap)
        if lap.end_time is not None and lap.end_time <= lights_out and lap.position is not None
    }
    first_lap: dict[str, Lap] = {}
    for lap in sorted(laps, key=lambda x: x.lap):
        if (
            lap.driver not in first_lap
            and lap.end_time is not None
            and lap.end_time >= lights_out + FIRST_LAP_AFTER
        ):
            first_lap[lap.driver] = lap
    slots = {d: grid_slot(tr, outline) for d, tr in after.items()}
    numbers = [lap.lap for lap in first_lap.values()]
    lap = max(set(numbers), key=numbers.count) if numbers else 2
    return analyse(after, slots, None, first_lap, lights_out, lap=lap, order=order)


@session_cache(maxsize=8)
def get_starts(year: int, round_number: int, code: str) -> list[Starts]:
    """The race start, then every standing restart after a red flag that has happened."""
    if code not in ("R", "S"):
        raise LookupError("Starts are for races and sprints")
    laps = sessions.get_laps(year, round_number, code)
    lap_1 = {lap.driver: lap for lap in laps if lap.lap == 1 and lap.start_time is not None}
    if not lap_1:
        raise LookupError("No first lap yet")
    lights_out = float(np.median([lap.start_time for lap in lap_1.values()]))
    outline = outline_of(year, round_number, code)
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
    out = [
        analyse(traces, slots, replays.starting_grid(year, round_number, code), lap_1, lights_out)
    ]
    # Lights out to the first moving sample at the race start, to place a restart's lights out.
    reactions = [m for tr in traces.values() if (m := moved_off(tr)) is not None]
    reaction = float(np.median(reactions)) if reactions else REACTION
    for red, called in suspensions(sessions.get_race_control(year, round_number, code)):
        again = restart(year, round_number, code, laps, red, called, reaction, outline)
        if again is not None:
            out.append(again)
    return out
