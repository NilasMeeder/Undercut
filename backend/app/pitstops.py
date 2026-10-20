"""How long each car stood still in its pit box. F1 sends it live (PitStopSeries: in recordings and
sessions downloaded from F1's archive); for the rest it is measured in the telemetry of the in-lap
and out-lap: from where the car comes to a stop in the pit lane to where it moves off. That is an
estimate: the car data comes every 0.1-0.3 s, so it is a tenth or two out either way.
"""

import numpy as np

from app import sessions, strategies
from app.energies import prefetch_laps
from app.generations import session_cache
from app.schemas import PitStopTime
from app.sources import tracinginsights as ti

STOPPED = 1.5
"""km/h: at or below this the car stands (the wheels can turn a little while it is jacked up)."""
LONGEST = 120.0
"""Seconds in the pit lane beyond which it is not a stop (a red flag, a car pushed back)."""


def stationary(
    times: np.ndarray, speeds: np.ndarray, pit_in: float, pit_out: float
) -> float | None:
    """Seconds stood still between pit entry and exit (session time), from the first to the last
    sample at a stop, each end halfway to the sample before or after it; None if it never stopped
    (a drive-through)."""
    inside = (times >= pit_in) & (times <= pit_out) & (speeds <= STOPPED)
    found = np.flatnonzero(inside)
    if len(found) == 0:
        return None
    first, last = found[0], found[-1]
    start = (times[first - 1] + times[first]) / 2 if first > 0 else times[first]
    end = (times[last] + times[last + 1]) / 2 if last + 1 < len(times) else times[last]
    return round(float(end - start), 2)


def _feed_times(year: int, round_number: int, code: str) -> dict[tuple[str, int], tuple]:
    """(driver, lap) -> (stationary, lane) as F1 sent them; empty without a recording."""
    event, session = sessions.folders(year, round_number, code)
    columns = ti.live_file(year, event, session, "pit_stops.json") or {}
    return {
        (driver, lap): (stood, lane)
        for driver, lap, stood, lane in zip(
            columns.get("drv", []),
            columns.get("lap", []),
            columns.get("stationary", []),
            columns.get("lane", []),
            strict=False,
        )
    }


def _from_feed(feed: dict[tuple[str, int], tuple], driver: str, lap: int) -> float | None:
    """F1 numbers the stop by the in-lap or the out-lap: either."""
    for candidate in (lap, lap + 1):
        found = feed.get((driver, candidate))
        if found is not None and found[0] is not None:
            return float(found[0])
    return None


def _measured(year: int, round_number: int, code: str, driver: str, stop) -> float | None:
    times, speeds = [], []
    starts = {lap.lap: lap.start_time for lap in sessions.get_laps(year, round_number, code)
              if lap.driver == driver}  # fmt: skip
    for lap in (stop.lap, stop.lap + 1):
        start = starts.get(lap)
        if start is None:
            continue
        try:
            trace = sessions.get_trace(year, round_number, code, driver, lap)
        except (ti.SourceNotAvailable, KeyError, OSError, ValueError):
            continue
        if "speed" in trace.channels:
            times.append(start + trace.time)
            speeds.append(trace.channels["speed"])
    if not times:
        return None
    return stationary(np.concatenate(times), np.concatenate(speeds), stop.pit_in, stop.pit_out)


@session_cache(maxsize=4)
def get_pit_stops(year: int, round_number: int, code: str) -> list[PitStopTime]:
    history = strategies.get_history(year, round_number, code)
    feed = _feed_times(year, round_number, code)
    stops = [(d.driver, s) for d in history.drivers for s in d.stops if s.lane <= LONGEST]
    if any(_from_feed(feed, driver, s.lap) is None for driver, s in stops):
        laps = sessions.get_laps(year, round_number, code)
        laps = [lap for lap in laps if lap.pit_in or lap.pit_out]
        prefetch_laps(year, round_number, code, laps)
    out = []
    for driver, stop in stops:
        official = _from_feed(feed, driver, stop.lap)
        measured = (
            None if official is not None else _measured(year, round_number, code, driver, stop)
        )
        out.append(
            PitStopTime(
                driver=driver,
                lap=stop.lap,
                t=stop.pit_in,
                lane=stop.lane,
                stationary=official if official is not None else measured,
                source="f1"
                if official is not None
                else "telemetry"
                if measured is not None
                else None,
                status=stop.status,
            )
        )
    return sorted(out, key=lambda s: s.t)
