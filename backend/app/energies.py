"""Energy estimates per session (see energy.py for the method).

The envelopes need every clean lap of the session, so the first request downloads the session's
telemetry in bulk (like the replay's position track). The work per lap is cached on its own and
outlives the generation of a live session: a lap's telemetry does not change once it is written,
so a live session only reads its new laps.
"""

from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from app import energy, sessions, strategy
from app.generations import session_cache
from app.live import recordings
from app.schemas import (
    ClipStretch,
    DriverEnergy,
    EnergyComparison,
    EnergyLap,
    EnergySession,
    EnergyStraight,
    EnergyStraightLap,
    EnergyStraightStats,
    Lap,
)
from app.sources import tracinginsights as ti

CLEAN_PACE = 1.07
"""Laps slower than this × the session's best clean lap say nothing about deployment."""

MAIN_STRAIGHT_SHARE = 0.5
"""A straight is shown if most clean laps have it: a lift on the way to a corner (Spa T9-10)
makes a run into that corner in some laps only."""


@dataclass(frozen=True)
class LapRuns:
    kinematics: energy.Kinematics
    straights: list[tuple[str, str, energy.Run]]
    profiles: dict[str, energy.Profile]
    """Per straight, for the envelopes."""
    length: float


@dataclass(frozen=True)
class SessionEnergy:
    session: energy.Envelope | None
    envelopes: dict[str, energy.Envelope]
    """Per straight (the corner it brakes for)."""
    order: list[str]
    """The straights shown, in track order."""
    after: dict[str, str]
    laps: dict[tuple[str, int], dict[str, energy.Straight]]
    """Every clean lap, per straight."""


def _corners(year: int, round_number: int, code: str, length: float) -> list[tuple[str, float]]:
    circuit = sessions.get_circuit(year, round_number, code)
    if not circuit.corners:
        raise LookupError("No corner data for this circuit")
    scale = length / circuit.lap_length if circuit.lap_length > 0 else 1.0
    return sorted(((c.label, c.distance * scale) for c in circuit.corners), key=lambda c: c[1])


@lru_cache(maxsize=4096)
def _lap_runs(
    year: int,
    round_number: int,
    code: str,
    driver: str,
    lap: int,
    _stamp: tuple[float | None, float | None],
) -> LapRuns | None:
    """`_stamp` (lap time, end time) tells a lap of a replaced recording from the old one."""
    try:
        trace = sessions.get_trace(year, round_number, code, driver, lap)
    except ti.SourceNotAvailable:
        return None
    if len(trace.distance) < 10 or not {"speed", "throttle", "brake"} <= trace.channels.keys():
        return None
    try:
        previous = sessions.get_trace(year, round_number, code, driver, lap - 1)
    except ti.SourceNotAvailable:
        previous = None
    k = energy.kinematics(trace, previous)
    straights = energy.straights(k, _corners(year, round_number, code, trace.length))
    profiles = {c: p for c, _, run in straights if (p := energy.samples(run, k)) is not None}
    return LapRuns(kinematics=k, straights=straights, profiles=profiles, length=trace.length)


def lap_runs(year: int, round_number: int, code: str, lap: Lap) -> LapRuns | None:
    return _lap_runs(year, round_number, code, lap.driver, lap.lap, (lap.lap_time, lap.end_time))


def clean_laps(laps: list[Lap]) -> list[Lap]:
    clean = [lap for lap in laps if strategy.is_clean(lap)]
    if not clean:
        return []
    best = min(lap.lap_time for lap in clean if lap.lap_time is not None)
    return [lap for lap in clean if lap.lap_time is not None and lap.lap_time <= best * CLEAN_PACE]


def _prefetch(year: int, round_number: int, code: str, laps: list[Lap]) -> None:
    event, session = sessions.folders(year, round_number, code)
    if recordings.has_recording(year, event, session):
        return  # a recording has its telemetry on disk, and TracingInsights does not have it
    files = sorted(
        {f"{lap.driver}/{n}_tel.json" for lap in laps for n in (lap.lap - 1, lap.lap) if n >= 1}
    )
    ti.prefetch(year, event, session, files, lambda _: None)


@session_cache(maxsize=4)
def get_session(year: int, round_number: int, code: str) -> SessionEnergy:
    laps = sessions.get_laps(year, round_number, code)
    clean = clean_laps(laps)
    _prefetch(year, round_number, code, clean)

    found: dict[tuple[str, int], LapRuns] = {}
    for lap in clean:
        runs = lap_runs(year, round_number, code, lap)
        if runs is not None:
            found[(lap.driver, lap.lap)] = runs

    per_corner: dict[str, list[energy.Profile]] = {}
    ends: dict[str, list[float]] = {}
    after: dict[str, list[str]] = {}
    for runs in found.values():
        for corner, start_corner, run in runs.straights:
            if corner in runs.profiles:
                per_corner.setdefault(corner, []).append(runs.profiles[corner])
            ends.setdefault(corner, []).append(float(runs.kinematics.distance[run.end - 1]))
            after.setdefault(corner, []).append(start_corner)

    session_envelope = energy.envelope([p for parts in per_corner.values() for p in parts])
    envelopes = {}
    for corner, parts in per_corner.items():
        own = energy.envelope(parts) or session_envelope
        if own is not None:
            envelopes[corner] = own

    needed = MAIN_STRAIGHT_SHARE * len(found)
    order = sorted(
        (c for c, e in ends.items() if len(e) >= needed and len(e) > 0),
        key=lambda c: float(np.median(ends[c])),
    )
    analysed = {
        key: {
            corner: energy.analyse(runs.kinematics, corner, start, run, envelopes.get(corner))
            for corner, start, run in runs.straights
            if corner in order
        }
        for key, runs in found.items()
    }
    return SessionEnergy(
        session=session_envelope,
        envelopes=envelopes,
        order=order,
        after={c: max(set(after[c]), key=after[c].count) for c in order},
        laps=analysed,
    )


def lap_straights(
    year: int, round_number: int, code: str, lap: Lap, result: SessionEnergy
) -> tuple[dict[str, energy.Straight], float] | None:
    """One lap (clean or not) on the session's straights, and the lap's length."""
    runs = lap_runs(year, round_number, code, lap)
    if runs is None:
        return None
    known = result.laps.get((lap.driver, lap.lap))
    if known is not None:
        return known, runs.length
    straights = {
        corner: energy.analyse(runs.kinematics, corner, start, run, result.envelopes.get(corner))
        for corner, start, run in runs.straights
        if corner in result.order
    }
    return straights, runs.length


def _stats(rows: list[energy.Straight]) -> EnergyStraightStats:
    return EnergyStraightStats(
        laps=len(rows),
        clipping=round(float(np.mean([r.clip_at is not None for r in rows])), 3),
        clipped=round(float(np.median([r.clipped for r in rows]))),
        cost_time=round(float(np.median([r.clip_cost_time for r in rows])), 3),
        peak_speed=round(float(np.median([r.peak_speed for r in rows])), 1),
    )


def _straights(result: SessionEnergy) -> list[EnergyStraight]:
    out = []
    for corner in result.order:
        rows = [laps[corner] for laps in result.laps.values() if corner in laps]
        out.append(
            EnergyStraight(
                corner=corner,
                after=result.after[corner],
                end=round(float(np.median([r.end for r in rows])), 1),
                session=_stats(rows),
            )
        )
    return out


def _straight_lap(row: energy.Straight, scale: float) -> EnergyStraightLap:
    def m(value: float) -> float:
        return round(value * scale, 1)

    return EnergyStraightLap(
        start=m(row.start),
        end=m(row.end),
        coast=round(row.coast),
        entry_speed=round(row.entry_speed, 1),
        peak_speed=round(row.peak_speed, 1),
        end_speed=round(row.end_speed, 1),
        clip_at=None if row.clip_at is None else m(row.clip_at),
        clipping=[ClipStretch(start=m(a), end=m(b)) for a, b in row.clipping],
        clipped=round(row.clipped * scale),
        cost_speed=round(row.clip_cost_speed, 1),
        cost_time=round(row.clip_cost_time, 3),
    )


def compare(
    year: int, round_number: int, code: str, refs: list[tuple[str, int]]
) -> EnergyComparison:
    """The laps on the session's straights, on the first lap's distance scale (like /compare)."""
    result = get_session(year, round_number, code)
    by_key = {(lap.driver, lap.lap): lap for lap in sessions.get_laps(year, round_number, code)}
    found = []
    for driver, number in refs:
        lap = by_key.get((driver, number))
        if lap is None:
            raise LookupError(f"{driver} has no lap {number} in this session")
        straights = lap_straights(year, round_number, code, lap, result)
        if straights is None:
            raise LookupError(f"No telemetry for {driver} lap {number}")
        found.append((lap, *straights))
    reference = found[0][2]
    laps = []
    for lap, rows, length in found:
        scale = reference / length if length > 0 else 1.0
        laps.append(
            EnergyLap(
                driver=lap.driver,
                lap=lap.lap,
                clipped=round(sum(r.clipped for r in rows.values()) * scale),
                cost_time=round(sum(r.clip_cost_time for r in rows.values()), 3),
                straights=[
                    _straight_lap(rows[c], scale) if c in rows else None for c in result.order
                ],
            )
        )
    return EnergyComparison(straights=_straights(result), laps=laps, clean_laps=len(result.laps))


@session_cache(maxsize=4)
def summary(year: int, round_number: int, code: str) -> EnergySession:
    """Per driver and straight over the clean laps: who clips where, and what it costs."""
    result = get_session(year, round_number, code)
    per_driver: dict[str, list[dict[str, energy.Straight]]] = {}
    for (driver, _), rows in result.laps.items():
        per_driver.setdefault(driver, []).append(rows)
    drivers = []
    for driver, laps in per_driver.items():
        stats = []
        for corner in result.order:
            rows = [lap[corner] for lap in laps if corner in lap]
            stats.append(_stats(rows) if rows else None)
        per_lap = [sum(r.clip_cost_time for r in lap.values()) for lap in laps]
        drivers.append(
            DriverEnergy(
                driver=driver,
                laps=len(laps),
                cost_time=round(float(np.median(per_lap)), 3),
                straights=stats,
            )
        )
    drivers.sort(key=lambda d: d.cost_time)
    return EnergySession(straights=_straights(result), drivers=drivers, clean_laps=len(result.laps))
