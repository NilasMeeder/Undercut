"""The weekend at a glance: every driver from the first practice to this session."""

from app import reports, schedule, sessions, setups
from app.generations import session_cache
from app.schemas import (
    Lap,
    WeekendCell,
    WeekendDriver,
    WeekendLongRun,
    WeekendOverview,
    WeekendSession,
)

RACES = ("R", "S")


def classification(code: str, laps: list[Lap]) -> dict[str, WeekendCell]:
    """Per driver his place in a session: in a race at the end, otherwise by best lap."""
    best = setups.best_laps(laps)
    fastest = best[0].lap_time if best else None
    bests = {lap.driver: lap.lap_time for lap in best}
    if code in RACES:
        last: dict[str, Lap] = {}
        for lap in laps:
            if lap.driver not in last or lap.lap > last[lap.driver].lap:
                last[lap.driver] = lap
        ranked = sorted(
            last.values(), key=lambda lap: (lap.position is None, lap.position or 0, -lap.lap)
        )
        order = [lap.driver for lap in ranked]
    else:
        order = [lap.driver for lap in best]
    out = {}
    for i, driver in enumerate(order):
        time = bests.get(driver)
        out[driver] = WeekendCell(
            position=i + 1,
            best=time,
            gap=None if time is None or fastest is None else round(time - fastest, 3),
        )
    return out


@session_cache(maxsize=4)
def overview(year: int, round_number: int, code: str) -> WeekendOverview:
    event, _ = schedule.resolve_session(year, round_number, code)
    codes = [s.code for s in event.sessions]
    included = codes[: codes.index(code) + 1]
    found: list[WeekendSession] = []
    cells: dict[str, dict[str, WeekendCell]] = {}
    runs: dict[str, WeekendLongRun] = {}
    pace: dict[str, float] = {}
    for session in included:
        try:
            laps = sessions.get_laps(year, round_number, session)
        except Exception:  # noqa: BLE001 - a session without data is left out
            continue
        found.append(WeekendSession(code=session, race=session in RACES))
        for driver, cell in classification(session, laps).items():
            cells.setdefault(driver, {})[session] = cell
        if session.startswith("FP"):
            for run in reports.long_runs(laps):
                # The longest run is the race simulation; a short one is often low on fuel.
                known = runs.get(run.driver)
                if known is None or (run.laps, -run.median) > (known.laps, -known.median):
                    runs[run.driver] = WeekendLongRun(
                        session=session,
                        compound=run.compound,
                        laps=run.laps,
                        median=run.median,
                    )
        if session == "R":
            for driver in {lap.driver for lap in laps}:
                median, _ = setups.race_pace(laps, driver)
                if median is not None:
                    pace[driver] = round(median, 3)
    latest = found[-1].code if found else code
    drivers = sorted(
        cells,
        key=lambda d: cells[d][latest].position if latest in cells[d] else 99,
    )
    return WeekendOverview(
        sessions=found,
        drivers=[
            WeekendDriver(
                driver=driver,
                cells=[cells[driver].get(s.code) for s in found],
                long_run=runs.get(driver),
                race_pace=pace.get(driver),
            )
            for driver in drivers
        ],
    )
