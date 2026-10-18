"""A session report: things worth looking at, each with the comparison that shows it.

The backend finds them (pure functions below, tested), the frontend writes the sentences. Every
item carries a ReportAction: laps to compare, a distance range to zoom to, or a moment on the clock.
"""

from collections import defaultdict

import numpy as np

from app import analysis, energies, replays, sessions, strategies, strategy
from app.generations import session_cache
from app.replay import driven
from app.schemas import (
    CornerLap,
    DriverRace,
    Lap,
    RaceHistory,
    ReportAction,
    ReportClipping,
    ReportCorner,
    ReportMoment,
    ReportRun,
    ReportStint,
    SessionReport,
    StatusPeriod,
)
from app.sources import tracinginsights as ti

CORNER_DRIVERS = 10
"""Best laps of this many drivers (quickest first) are held against the fastest lap."""

LENGTH_SLACK = 0.005
"""A lap whose telemetry is longer or shorter than the median by more than this share has a
hole or a glitch in its distance (Monza 2026 Q, GAS L17: 110 m too long): left out."""

LONG_RUN = 5
"""Laps at pace on one set from which a practice stint is a long run."""

RUN_PACE = 1.07
"""Laps slower than this × the driver's best lap are not at pace (cool-down, traffic)."""

DEG_MIN_LAPS = 8
"""A stint needs this many fitted laps to be named for its degradation."""

DEG_SHOWN = 3
"""Stints with the most degradation shown (and the one with the least)."""

START_PLACES = 3
"""Places gained or lost on lap 1 worth a line."""

UNDERCUT_LAPS = 4
"""The other car stopped at most this many laps later."""

UNDERCUT_GAP = 3.0
"""Seconds between the two cars before the first stop: closer than this it was a fight."""

GARAGE = 60.0
"""Seconds in the pit lane from which a stop is a repair (or a red flag), not a pit stop."""

CLIPPING_SHOWN = 3


def _ref(driver: str, lap: int) -> str:
    return f"{driver}:{lap}"


def _action(laps: list[str], zoom: tuple[float, float] | None = None, t: float | None = None):
    return ReportAction(
        laps=laps, zoom=None if zoom is None else [round(zoom[0], 1), round(zoom[1], 1)], t=t
    )


# --- Long runs (practice) -----------------------------------------------------------------------


def long_runs(laps: list[Lap]) -> list[ReportRun]:
    """Stints with at least LONG_RUN laps at pace, quickest median first per compound. The click
    compares the lap nearest the median with that of the quickest run on the same compound."""
    runs: list[tuple[ReportRun, int]] = []
    for driver, own in strategy.by_driver(laps).items():
        timed = [lap.lap_time for lap in own if lap.lap_time is not None and not lap.deleted]
        if not timed:
            continue
        limit = min(timed) * RUN_PACE
        per_stint: dict[int, list[Lap]] = defaultdict(list)
        for lap in own:
            if (
                strategy.is_clean(lap)
                and lap.lap_time is not None
                and lap.lap_time <= limit
                and lap.stint is not None
            ):
                per_stint[lap.stint].append(lap)
        for stint, at_pace in per_stint.items():
            if len(at_pace) < LONG_RUN:
                continue
            times = np.array([lap.lap_time for lap in at_pace], dtype=float)
            numbers = np.array([lap.lap for lap in at_pace], dtype=float)
            median = float(np.median(times))
            typical = at_pace[int(np.argmin(np.abs(times - median)))].lap
            slope = float(np.polyfit(numbers, times, 1)[0]) if np.ptp(numbers) > 0 else None
            run = ReportRun(
                driver=driver,
                stint=stint,
                compound=at_pace[0].compound,
                laps=len(at_pace),
                median=round(median, 3),
                best=round(float(times.min()), 3),
                slope=None if slope is None else round(slope, 3),
                action=_action([_ref(driver, typical)]),
            )
            runs.append((run, typical))
    runs.sort(key=lambda r: (r[0].compound or "", r[0].median))
    quickest: dict[str | None, str] = {}
    for run, typical in runs:
        own = _ref(run.driver, typical)
        lead = quickest.setdefault(run.compound, own)
        run.action.laps = [lead] if lead == own else [lead, own]
    return [run for run, _ in runs]


# --- Race moments -------------------------------------------------------------------------------


def _lap_at(leader_line: list[float], t: float) -> int:
    """The leader's lap at session time t (1 = before the first line)."""
    return 1 + int(np.searchsorted(leader_line, t, side="right"))


def start_moves(history: RaceHistory) -> list[ReportMoment]:
    """Places gained or lost on lap 1 (grid against the position at the line), if START_PLACES
    or more."""
    if not history.leader_line:
        return []
    field = len(history.drivers)
    out = []
    for d in history.drivers:
        if d.grid is None or not d.laps or d.laps[0] != 1 or d.position[0] is None:
            continue
        grid = field if d.grid == 99 else d.grid
        moved = grid - d.position[0]
        if abs(moved) >= START_PLACES:
            out.append(
                ReportMoment(
                    kind="start",
                    t=history.leader_line[0],
                    lap=1,
                    driver=d.driver,
                    other=None,
                    value=float(moved),
                    status=None,
                    until_lap=None,
                    action=_action([], t=history.leader_line[0]),
                )
            )
    out.sort(key=lambda m: -(m.value or 0))
    return out


def stop_extremes(history: RaceHistory) -> list[ReportMoment]:
    """The quickest and the slowest stop in the pit lane, green flag only."""
    stops = [
        (d.driver, s)
        for d in history.drivers
        for s in d.stops
        if s.status == "green" and s.lane < GARAGE
    ]
    if len(stops) < 2:
        return []
    out = []
    for kind, (driver, stop) in (
        ("fast_stop", min(stops, key=lambda x: x[1].lane)),
        ("slow_stop", max(stops, key=lambda x: x[1].lane)),
    ):
        out.append(
            ReportMoment(
                kind=kind,
                t=stop.pit_in,
                lap=stop.lap,
                driver=driver,
                other=None,
                value=round(stop.lane, 1),
                status=None,
                until_lap=None,
                action=_action([], t=max(stop.pit_in - 5, 0)),
            )
        )
    return out


def _gap(d: DriverRace, lap: int) -> float | None:
    if lap in d.laps:
        return d.gap[d.laps.index(lap)]
    return None


def undercuts(history: RaceHistory) -> list[ReportMoment]:
    """A car behind (within UNDERCUT_GAP) that stopped first and was ahead once both had stopped."""
    out = []
    for a in history.drivers:
        for stop in a.stops:
            before = stop.lap - 1
            for b in history.drivers:
                if b.driver == a.driver:
                    continue
                theirs = [s for s in b.stops if stop.lap < s.lap <= stop.lap + UNDERCUT_LAPS]
                if not theirs:
                    continue
                other = theirs[0]
                after = other.lap + 2
                if any(stop.lap < s.lap <= after for s in a.stops):
                    continue  # a stopped again: something else happened
                # Gaps to the first car on the same lap say who is ahead, and by how much.
                ga, gb = _gap(a, before), _gap(b, before)
                qa, qb = _gap(a, after), _gap(b, after)
                if ga is None or gb is None or qa is None or qb is None:
                    continue
                if 0 < ga - gb <= UNDERCUT_GAP and qa < qb:
                    out.append(
                        ReportMoment(
                            kind="undercut",
                            t=other.pit_out,
                            lap=other.lap + 1,
                            driver=a.driver,
                            other=b.driver,
                            value=None,
                            status=None,
                            until_lap=None,
                            action=_action([], t=max(other.pit_out - 3, 0)),
                        )
                    )
    return out


def flags(status: list[StatusPeriod], leader_line: list[float]) -> list[ReportMoment]:
    """Safety car, virtual safety car and red flag periods."""
    out = []
    for p in status:
        if p.status not in ("sc", "vsc", "red"):
            continue
        out.append(
            ReportMoment(
                kind="flag",
                t=p.start,
                lap=_lap_at(leader_line, p.start),
                driver=None,
                other=None,
                value=round(p.end - p.start, 1),
                status=p.status,
                until_lap=_lap_at(leader_line, p.end),
                action=_action([], t=p.start),
            )
        )
    # A VSC ending is its own period: one line per neutralisation.
    merged: list[ReportMoment] = []
    for m in out:
        if merged and merged[-1].status == m.status and m.t - merged[-1].t < 30:
            continue
        merged.append(m)
    return merged


# --- Per session --------------------------------------------------------------------------------


def _corners(year: int, round_number: int, code: str, laps: list[Lap]) -> list[ReportCorner]:
    best: dict[str, Lap] = {}
    for lap in laps:
        if lap.lap_time is None or lap.deleted or not driven(lap):
            continue
        if lap.driver not in best or lap.lap_time < best[lap.driver].lap_time:  # type: ignore[operator]
            best[lap.driver] = lap
    ranked = sorted(best.values(), key=lambda lap: lap.lap_time or 0)[:CORNER_DRIVERS]
    if len(ranked) < 2:
        return []
    energies.prefetch_laps(year, round_number, code, ranked)
    try:
        circuit = sessions.get_circuit(year, round_number, code)
    except ti.SourceNotAvailable:
        return []
    traces = []
    for lap in ranked:
        try:
            traces.append((lap, sessions.get_trace(year, round_number, code, lap.driver, lap.lap)))
        except ti.SourceNotAvailable:
            continue
    if len(traces) < 2:
        return []
    median = float(np.median([t.length for _, t in traces]))
    traces = [(lap, t) for lap, t in traces if abs(t.length / median - 1) <= LENGTH_SLACK]
    if len(traces) < 2:
        return []
    corners = [(c.label, c.distance) for c in circuit.corners]
    ref, ref_trace = traces[0]
    out = []
    for lap, trace in traces[1:]:
        segments = analysis.corner_segments(analysis.compare([ref_trace, trace]), corners)
        if not segments:
            continue
        worst = max(segments, key=lambda s: s.laps[1].time - s.laps[0].time)
        loss = worst.laps[1].time - worst.laps[0].time
        if loss <= 0:
            continue
        out.append(
            ReportCorner(
                driver=lap.driver,
                lap=lap.lap,
                reference=ref.driver,
                reference_lap=ref.lap,
                gap=round((lap.lap_time or 0) - (ref.lap_time or 0), 3),
                corner=worst.label,
                loss=round(loss, 3),
                reference_stats=_corner_lap(worst.laps[0]),
                stats=_corner_lap(worst.laps[1]),
                action=_action(
                    [_ref(ref.driver, ref.lap), _ref(lap.driver, lap.lap)],
                    (max(worst.start - 100, 0), worst.end + 100),
                ),
            )
        )
    return out


def _corner_lap(s: analysis.CornerStats) -> CornerLap:
    def one(v: float | None) -> float | None:
        return None if v is None else round(v, 1)

    return CornerLap(
        time=round(s.time, 3),
        brake_at=one(s.brake_at),
        min_speed=round(s.min_speed, 1),
        min_speed_at=round(s.min_speed_at, 1),
        throttle_at=one(s.throttle_at),
        top_speed=round(s.top_speed, 1),
    )


def _stints(year: int, round_number: int, code: str) -> tuple[list, list[ReportStint]]:
    deg = strategies.get_degradation(year, round_number, code, strategy.FUEL_EFFECT, None)
    fitted = [s for s in deg.stints if s.fit is not None and len(s.fit.laps) >= DEG_MIN_LAPS]
    fitted.sort(key=lambda s: -s.fit.slope)  # type: ignore[union-attr]
    shown = fitted[:DEG_SHOWN] + (fitted[-1:] if len(fitted) > DEG_SHOWN else [])
    stints = [
        ReportStint(
            driver=s.driver,
            stint=s.stint,
            compound=s.compound,
            slope=round(s.fit.slope, 3),  # type: ignore[union-attr]
            laps=len(s.fit.laps),  # type: ignore[union-attr]
            start_lap=s.start_lap,
            end_lap=s.end_lap,
            action=_action(
                [_ref(s.driver, s.fit.laps[0]), _ref(s.driver, s.fit.laps[-1])]  # type: ignore[union-attr]
            ),
        )
        for s in shown
    ]
    return deg.compounds, stints


def _clipping(year: int, round_number: int, code: str) -> list[ReportClipping]:
    if sessions.has_drs(year):
        return []
    summary = energies.summary(year, round_number, code)
    if len(summary.drivers) < 2:
        return []
    result = energies.get_session(year, round_number, code)
    laps = sessions.get_laps(year, round_number, code)
    least = summary.drivers[0]
    out = []
    for d in reversed(summary.drivers[1:]):
        if len(out) >= CLIPPING_SHOWN or d.cost_time - least.cost_time < 0.01:
            break
        diffs = [
            (mine.cost_time - theirs.cost_time if mine and theirs else -1.0, i)
            for i, (mine, theirs) in enumerate(zip(d.straights, least.straights, strict=True))
        ]
        diff, i = max(diffs)
        if diff <= 0:
            continue
        straight = summary.straights[i]
        starts = [
            rows[straight.corner].start for rows in result.laps.values() if straight.corner in rows
        ]
        start = max(float(np.median(starts)), 0.0)
        out.append(
            ReportClipping(
                driver=d.driver,
                cost_time=d.cost_time,
                reference=least.driver,
                reference_cost=least.cost_time,
                corner=straight.corner,
                after=straight.after,
                straight_cost=d.straights[i].cost_time,  # type: ignore[union-attr]
                action=_action(
                    [
                        _ref(least.driver, sessions.fastest_lap(laps, least.driver)),
                        _ref(d.driver, sessions.fastest_lap(laps, d.driver)),
                    ],
                    (start, straight.end + 150),
                ),
            )
        )
    return out


@session_cache(maxsize=4)
def get_report(year: int, round_number: int, code: str) -> SessionReport:
    laps = sessions.get_laps(year, round_number, code)
    timeline = replays.get_timeline(year, round_number, code)
    compounds, stints = _stints(year, round_number, code)
    moments: list[ReportMoment] = []
    if timeline.kind == "race":
        history = strategies.get_history(year, round_number, code)
        moments = sorted(
            start_moves(history)
            + stop_extremes(history)
            + undercuts(history)
            + flags(timeline.track_status, history.leader_line),
            key=lambda m: m.t,
        )
    return SessionReport(
        kind=timeline.kind,
        corners=_corners(year, round_number, code, laps),
        long_runs=long_runs(laps) if timeline.kind == "practice" else [],
        compounds=compounds,
        stints=stints,
        clipping=_clipping(year, round_number, code),
        moments=moments,
    )
