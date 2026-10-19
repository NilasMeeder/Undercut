"""The season so far: teammates against each other in qualifying, round by round.

Per round and team the best laps of the two drivers in the last part of qualifying both set a
time in (Q3 if both got there, else Q2, else Q1): what the car could do on the same track at
about the same time. A driver knocked out earlier is compared on his last part.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from itertools import combinations

import numpy as np

from app import schedule, sessions
from app.generations import session_cache
from app.schemas import DriverInfo, Lap, QualiDuel, SeasonPair, SeasonQuali, SeasonRound
from app.sources import tracinginsights as ti

PARTS = ("Q3", "Q2", "Q1")
OUTLIER_PCT = 3.0
"""A gap larger than this % of the quicker lap is a problem, not pace: no gap, still a win."""
WORKERS = 6
"""Rounds read at once the first time (one small file each from the archive)."""


def _bests(laps: list[Lap]) -> dict[str, dict[str | None, Lap]]:
    """Per driver his quickest counting lap in each part of qualifying."""
    out: dict[str, dict[str | None, Lap]] = {}
    for lap in laps:
        if lap.lap_time is None or lap.deleted:
            continue
        own = out.setdefault(lap.driver, {})
        best = own.get(lap.quali_segment)
        if best is None or lap.lap_time < (best.lap_time or 0):
            own[lap.quali_segment] = lap
    return out


def duel(round_number: int, a: str, b: str, bests: dict[str, dict[str | None, Lap]]) -> QualiDuel:
    """Driver a against b in one qualifying, in the last part both set a time in."""
    own_a, own_b = bests.get(a, {}), bests.get(b, {})
    parts = [p for p in (*PARTS, None) if p in own_a and p in own_b]
    if not parts:
        # One (or neither) set a time: his best, no gap.
        best_a = min(own_a.values(), key=lambda lap: lap.lap_time or 0, default=None)
        best_b = min(own_b.values(), key=lambda lap: lap.lap_time or 0, default=None)
        return QualiDuel(
            round=round_number,
            segment=None,
            a=best_a.lap_time if best_a else None,
            b=best_b.lap_time if best_b else None,
            a_lap=best_a.lap if best_a else None,
            b_lap=best_b.lap if best_b else None,
            gap=None,
            pct=None,
            ahead=0 if best_a else 1 if best_b else None,
        )
    part = parts[0]
    lap_a, lap_b = own_a[part], own_b[part]
    ta, tb = lap_a.lap_time or 0.0, lap_b.lap_time or 0.0
    pct = (tb - ta) / min(ta, tb) * 100
    # A lap far off the other (an aborted run, a problem) says nothing about the gap.
    fair = abs(pct) <= OUTLIER_PCT
    return QualiDuel(
        round=round_number,
        segment=part,
        a=ta,
        b=tb,
        a_lap=lap_a.lap,
        b_lap=lap_b.lap,
        gap=round(tb - ta, 3) if fair else None,
        pct=round(pct, 3) if fair else None,
        ahead=further if (further := _further(own_a, own_b)) is not None else int(tb < ta),
    )


def _further(own_a: dict[str | None, Lap], own_b: dict[str | None, Lap]) -> int | None:
    """0 when a reached a later part than b, 1 the other way round, None when the same."""
    reach = [min((PARTS.index(p) for p in own if p in PARTS), default=3) for own in (own_a, own_b)]
    if reach[0] == reach[1]:
        return None
    return 0 if reach[0] < reach[1] else 1


def round_duels(
    round_number: int, laps: list[Lap], drivers: list[DriverInfo]
) -> dict[tuple[str, str, str], QualiDuel]:
    """Every pair of teammates who drove this qualifying, keyed (team, a, b) with a < b."""
    driven = {lap.driver for lap in laps}
    bests = _bests(laps)
    teams: dict[str, list[str]] = {}
    for d in drivers:
        if d.code in driven and d.team:
            teams.setdefault(d.team, []).append(d.code)
    out = {}
    for team, codes in teams.items():
        for a, b in combinations(sorted(codes), 2):
            out[(team, a, b)] = duel(round_number, a, b, bests)
    return out


def pairs(
    rounds: list[int],
    duels: dict[int, dict[tuple[str, str, str], QualiDuel]],
    colors: dict[str, str],
) -> list[SeasonPair]:
    """The duels per pair over the season (by team name), the driver ahead more often first."""
    keys = sorted({key for per_round in duels.values() for key in per_round})
    out = []
    for team, a, b in keys:
        row = [duels.get(r, {}).get((team, a, b)) for r in rounds]
        gaps = [d.gap for d in row if d is not None and d.gap is not None]
        pcts = [d.pct for d in row if d is not None and d.pct is not None]
        ahead = [sum(d is not None and d.ahead == k for d in row) for k in (0, 1)]
        flip = ahead[1] > ahead[0] or (ahead[1] == ahead[0] and float(np.median(gaps or [0])) < 0)
        if flip:
            a, b = b, a
            ahead.reverse()
            gaps, pcts = [-g for g in gaps], [-p for p in pcts]
            row = [None if d is None else _flipped(d) for d in row]
        out.append(
            SeasonPair(
                team=team,
                color=colors.get(team, "#888888"),
                drivers=[a, b],
                duels=row,
                ahead=ahead,
                median_gap=round(float(np.median(gaps)), 3) if gaps else None,
                median_pct=round(float(np.median(pcts)), 3) if pcts else None,
            )
        )
    return out


def _flipped(d: QualiDuel) -> QualiDuel:
    return d.model_copy(
        update={
            "a": d.b,
            "b": d.a,
            "a_lap": d.b_lap,
            "b_lap": d.a_lap,
            "gap": None if d.gap is None else -d.gap,
            "pct": None if d.pct is None else -d.pct,
            "ahead": None if d.ahead is None else 1 - d.ahead,
        }
    )


def _started(start: datetime | None, now: datetime) -> bool:
    if start is None:
        return True
    return (start if start.tzinfo else start.replace(tzinfo=UTC)) <= now


def _read(year: int, round_number: int, code: str):
    try:
        return (
            sessions.get_laps(year, round_number, code),
            sessions.get_detail(year, round_number, code).drivers,
        )
    except (ti.SourceNotAvailable, KeyError, LookupError):
        return None


@session_cache(maxsize=8)
def season_quali(year: int, round_number: int, code: str, kind: str) -> SeasonQuali:
    """`kind` (Q or SQ) of every round of the year up to this one that has been driven."""
    now = datetime.now(UTC)
    events = [
        e
        for e in schedule.get_season_events(year).events
        if e.round <= round_number
        and any(s.code == kind and (s.start_utc is None or s.start_utc <= now) for s in e.sessions)
    ]
    with ThreadPoolExecutor(WORKERS) as pool:
        read = list(pool.map(lambda e: _read(year, e.round, kind), events))
    rounds: list[SeasonRound] = []
    duels: dict[int, dict[tuple[str, str, str], QualiDuel]] = {}
    colors: dict[str, str] = {}
    for event, data in zip(events, read, strict=True):
        if data is None:
            continue
        laps, drivers = data
        rounds.append(SeasonRound(round=event.round, name=event.name.replace(" Grand Prix", "")))
        duels[event.round] = round_duels(event.round, laps, drivers)
        colors |= {d.team: d.color for d in drivers if d.team}
    return SeasonQuali(
        year=year,
        session=kind,
        rounds=rounds,
        pairs=pairs([r.round for r in rounds], duels, colors),
    )
