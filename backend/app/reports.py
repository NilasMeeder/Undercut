"""A session report: things worth looking at, each with the comparison that shows it.

The backend finds them (pure functions below, tested), the frontend writes the sentences. Every
item carries a ReportAction: laps to compare, a distance range to zoom to, or a moment on the clock.
"""

import numpy as np

from app import analysis, energies, longruns, replays, sessions, strategies, strategy
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

PACE_WINDOW = 5
"""Clean laps on either side of a pace change, in the same stint."""

PACE_STEP = 0.7
"""Seconds a lap, against the field, from which a driver's pace changed."""

PACE_SIGNIFICANCE = 3.0
"""The step in standard deviations of the laps around the fit: smaller is the usual noise."""

PACE_OUTLIER = 1.0
"""A lap further than this (s) from the median of the five around it (traffic, a mistake)."""

FIELD_LAPS = 5
"""Clean laps of a lap number needed for the field's median (the reference of a pace change)."""

CLOSE = 1.2
"""Seconds behind the car ahead at which it holds you up."""


def _ref(driver: str, lap: int) -> str:
    return f"{driver}:{lap}"


def _action(laps: list[str], zoom: tuple[float, float] | None = None, t: float | None = None):
    return ReportAction(
        laps=laps, zoom=None if zoom is None else [round(zoom[0], 1), round(zoom[1], 1)], t=t
    )


# --- Long runs (practice) -----------------------------------------------------------------------


def long_runs(laps: list[Lap]) -> list[ReportRun]:
    """Stints with at least LONG_RUN laps at pace (longruns.find_runs), quickest median first per
    compound. The click compares the lap nearest the median with that of the quickest run on the
    same compound."""
    quickest: dict[str | None, str] = {}
    out = []
    for run in longruns.find_runs(laps, ""):
        own = _ref(run.driver, run.typical)
        lead = quickest.setdefault(run.compound, own)
        out.append(
            ReportRun(
                driver=run.driver,
                stint=run.stint,
                compound=run.compound,
                laps=run.laps,
                median=run.median,
                best=run.best,
                slope=run.slope,
                action=_action([lead] if lead == own else [lead, own]),
            )
        )
    return out


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


def _sse(columns: list[np.ndarray], y: np.ndarray) -> tuple[np.ndarray, float]:
    coef, *_ = np.linalg.lstsq(np.column_stack(columns), y, rcond=None)
    residual = y - np.column_stack(columns) @ coef
    return coef, float(residual @ residual)


def pace_step(laps: list[int], rel: list[float]) -> tuple[int, float] | None:
    """Where a stint's lap times (against the field) step to another level, and by how much.

    A line with a step in it against the stint's own trend (its degradation stays in the slope):
    the break with the smallest residual, if the step is at least PACE_STEP, PACE_SIGNIFICANCE
    times the noise around the fit, and the PACE_WINDOW laps before and after it (medians) differ
    as much in the same direction. Returns the first lap at the new pace and the step (s/lap,
    negative = quicker)."""
    x, y = np.asarray(laps, float), np.asarray(rel, float)
    around = np.array([np.median(y[max(0, i - 2) : i + 3]) for i in range(len(y))])
    keep = np.abs(y - around) <= PACE_OUTLIER
    x, y = x[keep], y[keep]
    w = PACE_WINDOW
    if len(x) < 2 * w:
        return None
    base = [np.ones_like(x), x]
    best: tuple[int, float, float] | None = None
    for i in range(w, len(x) - w + 1):
        coef, sse = _sse([*base, (np.arange(len(x)) >= i).astype(float)], y)
        if best is None or sse < best[1]:
            best = (i, sse, float(coef[2]))
    assert best is not None
    i, sse, step = best
    noise = np.sqrt(sse / (len(x) - 3))
    local = float(np.median(y[i : i + w]) - np.median(y[i - w : i]))
    if abs(step) < PACE_STEP or abs(step) < PACE_SIGNIFICANCE * noise:
        return None
    if abs(local) < PACE_STEP or np.sign(local) != np.sign(step):
        return None
    return int(x[i]), round(local, 2)


def _ahead(history: RaceHistory, me: DriverRace, lap: int) -> tuple[str, float] | None:
    """The car ahead on the same lap at its end and the interval to it (from the gaps)."""
    mine = _gap(me, lap)
    if mine is None:
        return None
    ahead = [
        (d.driver, mine - theirs)
        for d in history.drivers
        if d.driver != me.driver and (theirs := _gap(d, lap)) is not None and theirs < mine
    ]
    return min(ahead, key=lambda a: a[1], default=None)


def _pace_cause(history: RaceHistory, d: DriverRace, lap: int, step: float) -> str | None:
    """Slower behind a car it caught, or quicker once free of the car that held it up."""
    if step > 0:
        held = [_ahead(history, d, n) for n in (lap, lap + 1, lap + 2)]
        cars = [a[0] for a in held if a is not None and a[1] <= CLOSE]
        return cars[0] if len(cars) >= 2 and cars.count(cars[0]) >= 2 else None
    before = _ahead(history, d, lap - 1)
    if before is None or before[1] > CLOSE:
        return None
    after = _ahead(history, d, lap + 1)
    free = after is None or after[0] != before[0] or after[1] > 2 * CLOSE
    return before[0] if free else None


def pace_changes(history: RaceHistory) -> list[ReportMoment]:
    """A driver whose pace steps up or down within a stint (pace_step), against the field's
    median on each lap (fuel, track and weather are the same for everyone). The other car is the
    one it caught (slower) or got free of (quicker), if any."""
    on_lap: dict[int, list[float]] = {}
    for d in history.drivers:
        for lap, time, clean in zip(d.laps, d.lap_time, d.clean, strict=True):
            if clean and time is not None:
                on_lap.setdefault(lap, []).append(time)
    field = {lap: float(np.median(v)) for lap, v in on_lap.items() if len(v) >= FIELD_LAPS}
    out = []
    for d in history.drivers:
        for stint in d.stints:
            laps, rel = [], []
            for lap, time, clean in zip(d.laps, d.lap_time, d.clean, strict=True):
                if stint.start_lap <= lap <= stint.end_lap and clean and time and lap in field:
                    laps.append(lap)
                    rel.append(time - field[lap])
            found = pace_step(laps, rel)
            if found is None:
                continue
            lap, step = found
            before = max((n for n in laps if n < lap), default=lap - 1)
            started = d.line[d.laps.index(lap - 1)] if lap - 1 in d.laps else None
            if started is None:
                continue
            fifth = [n for n in laps if n >= lap][PACE_WINDOW - 1]
            out.append(
                ReportMoment(
                    kind="pace",
                    t=started,
                    lap=lap,
                    driver=d.driver,
                    other=_pace_cause(history, d, lap, step),
                    value=step,
                    status=None,
                    until_lap=None,
                    action=_action(
                        [_ref(d.driver, before), _ref(d.driver, lap)], t=max(started - 3, 0)
                    ),
                    known=d.line[d.laps.index(fifth)],
                )
            )
    return out


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
    traces = [(lap, t) for lap, t in traces if analysis.length_off(t.length, median) is None]
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
            + pace_changes(history)
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
