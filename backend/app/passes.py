"""On-track passes in a race, from the position track.

A pass is two cars on the same lap changing order on track: from at least MARGIN metres behind
to at least MARGIN metres ahead (a threshold with a margin, so two cars nose to tail do not
"pass" each other on the noise of the position estimate, ~12 m), each order held for HOLD
seconds. Left out: anything near a pit stop of either car, laps that are not racing (safety car,
red flag, formation: slower than RACING × the median lap), the start and every standing restart
(the field sorting itself side by side), a car that has as good as stopped (a retirement, a
spin), and after either car finished. Lapping (one car a lap ahead) is not a pass for position
and never shows up: only cars within half a lap of each other are compared.

An estimate: the position track is 4 Hz, made from each lap's own distance; a chicane cut or a
lap with a gap in its telemetry can make a swap that did not happen.
"""

from dataclasses import dataclass

import numpy as np

from app import overtake, replays, sessions, straight_mode
from app.generations import session_cache
from app.replay import Track
from app.schemas import Corner, Lap, OvertakeCheck, Pass, RaceControlMessage, StatusPeriod

MARGIN = 25.0
"""Metres behind before and ahead after."""
HOLD = 2.0
"""Seconds each order must last."""
MAX_GAP = 5.0
"""Seconds of not knowing the order (a short flicker, missing data) a pass may span."""
PIT_BEFORE = 10.0
PIT_AFTER = 5.0
"""Seconds around a pit stop (pit entry to exit) that do not count."""
RACING = 1.2
"""A lap slower than this × the session's median lap is not racing."""
STOPPED = 0.35
"""The passed car goes slower than this share of the passer's pace: it has stopped."""
PACE_WINDOW = 6.0
"""Seconds either side to measure that pace over."""
NEUTRAL = ("sc", "vsc", "vsc_ending", "red")


@dataclass(frozen=True)
class Swap:
    """Car `ahead` (index) got ahead of car `behind` at sample `at` (fractional)."""

    ahead: int
    behind: int
    at: float


def _forward_fill(values: np.ndarray, assigned: np.ndarray) -> np.ndarray:
    """Each sample the last assigned value at or before it (0 before the first)."""
    index = np.where(assigned, np.arange(len(values)), 0)
    np.maximum.accumulate(index, out=index)
    out = values[index]
    out[: np.argmax(assigned) if assigned.any() else len(values)] = 0
    return out


def swaps(track: Track, margin: float = MARGIN, hold: float = HOLD) -> list[Swap]:
    """Every change of order between two cars on the same lap, with a margin either side."""
    progress = track.progress
    eps = margin / track.lap_length
    hold_n = max(int(round(hold / track.step)), 1)
    gap_n = int(round(MAX_GAP / track.step))
    out: list[Swap] = []
    n = len(track.drivers)
    for a in range(n):
        for b in range(a + 1, n):
            d = progress[a] - progress[b]
            known = np.isfinite(d) & (np.abs(d) < 0.5)
            if not known.any():
                continue
            sign = np.sign(np.where(known, d, 0.0))
            assigned = ~known | (np.abs(d) > eps)
            state = _forward_fill(np.where(known, sign, 0.0), assigned)
            # Runs of the same order, long enough to count.
            edges = np.flatnonzero(np.diff(state)) + 1
            starts = np.concatenate([[0], edges])
            ends = np.concatenate([edges, [len(state)]])
            runs = [
                (s, e, state[s])
                for s, e in zip(starts, ends, strict=True)
                if state[s] != 0 and e - s >= hold_n
            ]
            for (start0, end0, s0), (start1, _, s1) in zip(runs, runs[1:], strict=False):
                if s0 == s1 or start1 - end0 > gap_n:
                    continue
                # Where d last crossed zero: after the last sample clearly in the old order
                # (the state only flips once the new order is MARGIN clear), interpolated.
                clear = np.flatnonzero(s0 * d[start0:end0] > eps)
                first = start0 + (int(clear[-1]) if len(clear) else end0 - start0 - 1)
                window = d[first : start1 + 1]
                flips = np.flatnonzero(np.sign(window[:-1]) != np.sign(window[1:]))
                q = first + (int(flips[-1]) if len(flips) else 0)
                d0, d1 = d[q], d[q + 1]
                share = d0 / (d0 - d1) if np.isfinite(d0 - d1) and d0 != d1 else 0.5
                at = q + float(np.clip(share, 0.0, 1.0))
                out.append(Swap(ahead=a, behind=b, at=at) if s1 > 0 else Swap(b, a, at))
    return sorted(out, key=lambda s: s.at)


def pit_windows(laps: list[Lap]) -> dict[str, list[tuple[float, float]]]:
    """Per driver the stretches around his pit stops (entry to exit, plus margins)."""
    by_driver: dict[str, list[Lap]] = {}
    for lap in laps:
        by_driver.setdefault(lap.driver, []).append(lap)
    out: dict[str, list[tuple[float, float]]] = {}
    for driver, own in by_driver.items():
        own.sort(key=lambda lap: lap.lap)
        windows = []
        for i, lap in enumerate(own):
            if lap.pit_in_time is None:
                continue
            following = own[i + 1] if i + 1 < len(own) else None
            exit_time = following.pit_out_time if following else None
            windows.append(
                (
                    lap.pit_in_time - PIT_BEFORE,
                    np.inf if exit_time is None else exit_time + PIT_AFTER,
                )
            )
        out[driver] = windows
    return out


def _inside(t: float, windows: list[tuple[float, float]]) -> bool:
    return any(a <= t <= b for a, b in windows)


def corner_into(distance: float, corners: list[Corner], scale: float) -> str | None:
    """The corner a pass at this distance (m) goes into: the first one at most 150 m before it
    or after it (passes happen under braking)."""
    ahead = [c for c in corners if c.distance * scale >= distance - 150]
    target = ahead[0] if ahead else (corners[0] if corners else None)
    return None if target is None else f"T{target.label}"


def last_check(checks: list[OvertakeCheck], driver: str, t: float) -> OvertakeCheck | None:
    found = None
    for check in checks:
        if check.time > t:
            break
        if check.driver == driver:
            found = check
    return found


def passes(
    track: Track,
    laps: list[Lap],
    track_status: list[StatusPeriod],
    messages: list[RaceControlMessage],
    corners: list[Corner],
    corner_scale: float,
    checks: list[OvertakeCheck] | None,
    overtake_on: list[tuple[float, float]],
) -> list[Pass]:
    timed = sorted(lap.lap_time for lap in laps if lap.lap_time)
    if not timed:
        return []
    median = timed[len(timed) // 2]
    racing = {
        (lap.driver, lap.lap) for lap in laps if lap.lap_time and lap.lap_time <= RACING * median
    }
    restarts = {1} | {
        m.lap for m in messages if m.lap is not None and "STANDING START" in m.message
    }
    finished = {}
    for lap in laps:
        if lap.end_time is not None:
            finished[lap.driver] = max(finished.get(lap.driver, 0.0), lap.end_time)
    pits = pit_windows(laps)
    neutral = [(p.start, p.end) for p in track_status if p.status in NEUTRAL]
    first_start = min(
        (lap.start_time for lap in laps if lap.lap == 1 and lap.start_time is not None),
        default=track.start,
    )
    pace_n = int(round(PACE_WINDOW / track.step))
    samples = track.progress.shape[1]

    out = []
    for swap in swaps(track):
        k = int(np.floor(swap.at))
        t = track.start + track.step * swap.at
        driver, passed = track.drivers[swap.ahead], track.drivers[swap.behind]
        if t < first_start or t > min(finished.get(driver, np.inf), finished.get(passed, np.inf)):
            continue
        if _inside(t, pits.get(driver, [])) or _inside(t, pits.get(passed, [])):
            continue
        if _inside(t, neutral):
            continue
        p_driver, p_passed = track.progress[swap.ahead, k], track.progress[swap.behind, k]
        lap = int(np.floor(p_driver)) + 1
        if lap in restarts:
            continue
        if (driver, lap) not in racing or (passed, int(np.floor(p_passed)) + 1) not in racing:
            continue
        lo, hi = max(k - pace_n, 0), min(k + pace_n, samples - 1)
        with np.errstate(all="ignore"):
            pace = np.nanmedian(np.diff(track.progress[swap.ahead, lo:hi]))
            pace_passed = np.nanmedian(np.diff(track.progress[swap.behind, lo:hi]))
        if not (np.isfinite(pace) and np.isfinite(pace_passed)) or pace_passed < STOPPED * pace:
            continue
        column = track.progress[:, min(k + 1, samples - 1)]
        position = 1 + int(np.sum(np.isfinite(column) & (column > column[swap.ahead])))
        distance = float((p_driver % 1) * track.lap_length)
        with_overtake = None
        if checks is not None:
            check = last_check(checks, driver, t)
            with_overtake = bool(
                check is not None and check.within and check.enabled and _inside(t, overtake_on)
            )
        out.append(
            Pass(
                time=round(t, 2),
                lap=lap,
                driver=driver,
                passed=passed,
                distance=round(distance),
                fraction=round(float(p_driver % 1), 4),
                corner=corner_into(distance, corners, corner_scale),
                position=position,
                overtake_mode=with_overtake,
            )
        )
    return out


@session_cache(maxsize=8)
def get_passes(year: int, round_number: int, code: str) -> list[Pass]:
    if code not in ("R", "S"):
        raise LookupError("Passes are for races and sprints")
    track = replays.position_track(year, round_number, code)
    timeline = replays.get_timeline(year, round_number, code)
    circuit = sessions.get_circuit(year, round_number, code)
    mode = straight_mode.get_straight_mode(year, round_number, code)
    checks = None
    if mode.overtake is not None:
        checks = overtake.get_checks(year, round_number, code).checks
    on = [(p.start, np.inf if p.end is None else p.end) for p in mode.overtake_enabled]
    return passes(
        track,
        sessions.get_laps(year, round_number, code),
        timeline.track_status,
        sessions.get_race_control(year, round_number, code),
        circuit.corners,
        track.lap_length / circuit.lap_length if circuit.lap_length else 1.0,
        checks,
        on,
    )
