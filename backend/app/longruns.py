"""Long runs in practice: at least LONG_RUN laps at pace on one set, compared per compound.
The fuel load is unknown in practice, so medians compare only roughly (a lighter car is
quicker); `deg` puts an assumed burn back into the slope to show the tyres."""

from collections import defaultdict

import numpy as np

from app import pace, schedule, sessions, strategy
from app.generations import session_cache
from app.schemas import Lap, LongRun, LongRuns

LONG_RUN = 5
"""Laps at pace on one set from which a practice stint is a long run."""

RUN_PACE = 1.07
"""Laps slower than this × the driver's best lap are not at pace (cool-down, traffic)."""

BREAK = 2
"""Laps not at pace in a row that end a run (one is traffic or a cool lap in the middle)."""

DENSITY = 0.6
"""Share of a run's laps that must be at pace: push, cool, push, cool is a qualifying run."""

STEP_WINDOW = 4
"""Laps at pace on either side of a pace change within a run (pace.step; a race uses 5, but
practice runs are short)."""


def blocks(stint_laps: list[Lap], at_pace: set[int]) -> list[list[Lap]]:
    """The laps at pace of a stint in runs: a run ends at BREAK laps in a row not at pace; a run
    counts with LONG_RUN laps at pace that are at least DENSITY of its laps."""
    out: list[list[Lap]] = []
    current: list[Lap] = []
    misses = 0
    for lap in stint_laps:
        if lap.lap in at_pace:
            current.append(lap)
            misses = 0
            continue
        misses += 1
        if misses >= BREAK and current:
            out.append(current)
            current = []
    if current:
        out.append(current)
    return [
        run
        for run in out
        if len(run) >= LONG_RUN and len(run) >= DENSITY * (run[-1].lap - run[0].lap + 1)
    ]


def find_runs(
    laps: list[Lap],
    session: str,
    until: float | None = None,
    fuel: float = strategy.FUEL_EFFECT,
) -> list[LongRun]:
    """Every long run of the session up to `until`, quickest median per compound first; `gap`
    is against the quickest of these runs on the same compound."""
    burn = strategy.fuel_per_lap(None, fuel)
    runs: list[LongRun] = []
    for driver, own in strategy.by_driver(laps).items():
        own = [lap for lap in own if strategy.done(lap, until)]
        timed = [lap.lap_time for lap in own if lap.lap_time is not None and not lap.deleted]
        if not timed:
            continue
        limit = min(timed) * RUN_PACE
        per_stint: dict[int, list[Lap]] = defaultdict(list)
        for lap in own:
            if lap.stint is not None:
                per_stint[lap.stint].append(lap)
        for stint, stint_laps in per_stint.items():
            pace_laps = {
                lap.lap
                for lap in stint_laps
                if strategy.is_clean(lap) and lap.lap_time is not None and lap.lap_time <= limit
            }
            for at_pace in blocks(stint_laps, pace_laps):
                runs.append(_run(session, driver, stint, stint_laps, at_pace, burn))
    return ranked(runs)


def _run(
    session: str, driver: str, stint: int, stint_laps: list[Lap], at_pace: list[Lap], burn: float
) -> LongRun:
    times = np.array([lap.lap_time for lap in at_pace], dtype=float)
    numbers = np.array([lap.lap for lap in at_pace], dtype=float)
    median = float(np.median(times))
    slope = float(np.polyfit(numbers, times, 1)[0]) if np.ptp(numbers) > 0 else None
    first, last = at_pace[0].lap, at_pace[-1].lap
    by_lap = {lap.lap: lap.lap_time for lap in at_pace}
    life = stint_laps[0].tyre_life
    step = pace.step([lap.lap for lap in at_pace], list(times), STEP_WINDOW)
    return LongRun(
        session=session,
        driver=driver,
        stint=stint,
        compound=at_pace[0].compound,
        used=None if life is None else max(life - 1, 0),
        start_lap=first,
        end_lap=last,
        start=at_pace[0].start_time,
        laps=len(at_pace),
        median=round(median, 3),
        best=round(float(times.min()), 3),
        slope=None if slope is None else round(slope, 3),
        deg=None if slope is None else round(slope + burn, 3),
        gap=0.0,
        times=[by_lap.get(n) for n in range(first, last + 1)],
        typical=at_pace[int(np.argmin(np.abs(times - median)))].lap,
        open=not any(lap.pit_in for lap in stint_laps),
        step_lap=None if step is None else step[0],
        step=None if step is None else step[1],
    )


def ranked(runs: list[LongRun]) -> list[LongRun]:
    """Per compound (soft first), quickest median first, with the gap to that quickest."""
    order = {"SOFT": 0, "MEDIUM": 1, "HARD": 2, "INTERMEDIATE": 3, "WET": 4}
    runs = sorted(runs, key=lambda r: (order.get(r.compound or "", 5), r.median))
    quickest: dict[str | None, float] = {}
    for run in runs:
        run.gap = round(run.median - quickest.setdefault(run.compound, run.median), 3)
    return runs


@session_cache(maxsize=64)
def get_long_runs(
    year: int, round_number: int, code: str, until: float | None, fuel: float, weekend: bool
) -> LongRuns:
    """This session's long runs (practice), and with `weekend` also those of the practice
    sessions before it (all of them, whatever the cutoff)."""
    codes = [code]
    if weekend:
        event, _ = schedule.resolve_session(year, round_number, code)
        names = [s.code for s in event.sessions]
        codes = [c for c in names[: names.index(code) + 1] if c.startswith("FP")]
    runs: list[LongRun] = []
    for session in codes:
        if not session.startswith("FP"):
            continue
        try:
            laps = sessions.get_laps(year, round_number, session)
        except Exception:  # noqa: BLE001 - a session without data is left out
            continue
        runs += find_runs(laps, session, until if session == code else None, fuel)
    return LongRuns(runs=ranked(runs), fuel_per_lap=round(strategy.fuel_per_lap(None, fuel), 4))
