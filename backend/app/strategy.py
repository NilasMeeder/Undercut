"""Strategy and race analysis from the lap data alone (no telemetry), pure functions.

- history: every driver lap by lap (line crossings, gaps, positions, stints, pit stops).
- degradation: per stint a straight line through the fuel-corrected lap times against tyre age.
- pit_window: where a driver rejoins after a stop now, and undercut/overcut on the cars around.
- forecast: the predicted result from the pace at the cutoff, with the stops still owed.
- pit_calculator: every car's rejoin if it stops now (under a safety car).

Everything takes an `until` (session time): only laps completed by then count, so the session
clock can step through a race without seeing the future.
"""

import math
from collections import defaultdict
from dataclasses import dataclass

import numpy as np

from app.replay import LIVE_RUNNING_FOR, driven, status_at
from app.schemas import (
    CompoundPace,
    DegFit,
    Degradation,
    DriverRace,
    Duel,
    Forecast,
    ForecastPass,
    ForecastRow,
    Lap,
    PitCalculator,
    PitNowRow,
    PitStop,
    PitWindow,
    RaceHistory,
    Rejoin,
    StatusPeriod,
    Stint,
    StintPace,
    TrackStatus,
)

FUEL_START = 100.0
"""kg of fuel at the start of a race (the limit is 110 kg; teams start a bit under it)."""
PRACTICE_BURN = 1.8
"""kg per lap outside races, where the fuel load is unknown (about 100 kg over a race distance)."""
FUEL_EFFECT = 0.03
"""Seconds per lap per kg of fuel, a common estimate (track-dependent)."""
CLEAN_STATUS = set("12")
"""Track status digits a clean lap may have: green and yellow (not SC 4, red 5, VSC 6/7)."""
MIN_FIT_LAPS = 4
COOL_DOWN = 1.07
"""A lap this much slower than the stint's quickest clean lap is a cool-down or SC-paced lap."""
OUTLIER_FLOOR = 0.6
"""A lap further than this (s) and 2.5 standard deviations from the fit is traffic or a mistake."""
FIT_ROUNDS = 3
STOP_REFERENCE_LAPS = 3
"""Laps either side of a stop whose median is the driver's pace, to measure the stop's loss."""
DUEL_LAPS = 3
"""Undercut/overcut: the other car stops 1 to DUEL_LAPS laps later."""
DEFAULT_PIT_LOSS = 22.0
"""Seconds, for a circuit without an estimate in the archive."""
LAP_DONE_SLACK = 0.01
"""The cutoff is a lap end time; floating point must not drop that lap."""

NEXT_COMPOUND = {"SOFT": "HARD", "MEDIUM": "HARD", "HARD": "MEDIUM"}
"""A guess at the set a driver goes to when none is given: another dry compound."""


def fuel_per_lap(total_laps: int | None, effect: float = FUEL_EFFECT) -> float:
    """Seconds a lap gets quicker from the fuel burnt on the lap before it."""
    if not total_laps:
        return effect * PRACTICE_BURN
    return effect * FUEL_START / total_laps


def corrected(lap: Lap, fuel: float, total_laps: int | None) -> float | None:
    """Lap time as if run with the fuel of the last lap."""
    if lap.lap_time is None:
        return None
    return lap.lap_time - fuel * ((total_laps or lap.lap) - lap.lap)


def is_clean(lap: Lap) -> bool:
    """A racing lap that says something about pace: timed, no pit lane, not lap 1, no SC/VSC."""
    return (
        lap.lap_time is not None
        and lap.lap > 1
        and not lap.pit_in
        and not lap.pit_out
        and not lap.deleted
        and set(lap.track_status or "1") <= CLEAN_STATUS
    )


def done(lap: Lap, until: float | None) -> bool:
    if until is None:
        return True
    return lap.end_time is not None and lap.end_time <= until + LAP_DONE_SLACK


def by_driver(laps: list[Lap]) -> dict[str, list[Lap]]:
    """Driven laps per driver, in lap order."""
    out: dict[str, list[Lap]] = defaultdict(list)
    for lap in laps:
        if driven(lap):
            out[lap.driver].append(lap)
    for own in out.values():
        own.sort(key=lambda lap: lap.lap)
    return dict(out)


# --- Degradation ---------------------------------------------------------------------------------


@dataclass
class Fit:
    slope: float
    base: float
    residual: float
    laps: list[int]

    def at(self, age: float) -> float:
        return self.base + self.slope * age


def fit_line(ages: list[float], times: list[float], laps: list[int]) -> Fit | None:
    """Least squares, refitted without outliers until none are left (at most FIT_ROUNDS)."""
    x, y, n = np.asarray(ages, float), np.asarray(times, float), np.asarray(laps)
    for _ in range(FIT_ROUNDS):
        if len(x) < MIN_FIT_LAPS or np.ptp(x) == 0:
            return None
        slope, base = np.polyfit(x, y, 1)
        residual = y - (base + slope * x)
        keep = np.abs(residual) <= max(OUTLIER_FLOOR, 2.5 * float(np.std(residual)))
        if keep.all():
            break
        x, y, n = x[keep], y[keep], n[keep]
    if len(x) < MIN_FIT_LAPS or np.ptp(x) == 0:
        return None
    slope, base = np.polyfit(x, y, 1)
    spread = float(np.std(y - (base + slope * x)))
    return Fit(float(slope), float(base), spread, [int(v) for v in n])


def stints(own: list[Lap]) -> list[Stint]:
    groups: dict[int, list[Lap]] = defaultdict(list)
    current = 1
    for lap in own:
        current = lap.stint if lap.stint is not None else current
        groups[current].append(lap)
    out = []
    for number, laps in sorted(groups.items()):
        compound = next((lap.compound for lap in laps if lap.compound), None)
        out.append(
            Stint(
                number=number,
                compound=compound,
                fresh=laps[0].fresh_tyre,
                start_lap=laps[0].lap,
                end_lap=laps[-1].lap,
                start_life=laps[0].tyre_life,
            )
        )
    return out


def stint_fits(
    own: list[Lap], fuel: float, total_laps: int | None, until: float | None
) -> list[tuple[Stint, Fit | None]]:
    """Each stint of a driver (up to the cutoff) with its degradation fit."""
    seen = [lap for lap in own if done(lap, until)]
    out = []
    for stint in stints(seen):
        laps = [
            lap
            for lap in seen
            if stint.start_lap <= lap.lap <= stint.end_lap
            and is_clean(lap)
            and lap.tyre_life is not None
        ]
        if laps:
            quickest = min(lap.lap_time or math.inf for lap in laps)
            laps = [lap for lap in laps if (lap.lap_time or math.inf) <= quickest * COOL_DOWN]
        fit = fit_line(
            [lap.tyre_life for lap in laps],
            [corrected(lap, fuel, total_laps) for lap in laps],
            [lap.lap for lap in laps],
        )
        out.append((stint, fit))
    return out


def compound_paces(fits: list[tuple[Stint, Fit | None]]) -> list[CompoundPace]:
    pooled: dict[str, list[Fit]] = defaultdict(list)
    for stint, fit in fits:
        if fit and stint.compound:
            pooled[stint.compound].append(fit)
    out = []
    for compound, group in sorted(pooled.items()):
        weights = np.array([len(f.laps) for f in group], float)
        out.append(
            CompoundPace(
                compound=compound,
                slope=round(float(np.average([f.slope for f in group], weights=weights)), 4),
                base=round(float(np.median([f.base for f in group])), 3),
                stints=len(group),
                laps=int(weights.sum()),
            )
        )
    return out


def _deg_fit(fit: Fit | None) -> DegFit | None:
    if fit is None:
        return None
    return DegFit(
        slope=round(fit.slope, 4),
        base=round(fit.base, 3),
        residual=round(fit.residual, 3),
        laps=fit.laps,
    )


@dataclass
class Paces:
    """Every stint fit up to a cutoff, as the degradation response and the pit window use them."""

    fuel: float
    total_laps: int | None
    fits: dict[str, list[tuple[Stint, Fit | None]]]
    compounds: dict[str, CompoundPace]


def paces(laps: list[Lap], total_laps: int | None, effect: float, until: float | None) -> Paces:
    fuel = fuel_per_lap(total_laps, effect)
    # Outside races lap times are corrected to the session's last lap: only slopes compare.
    total_laps = total_laps or max((lap.lap for lap in laps), default=None)
    fits = {
        driver: stint_fits(own, fuel, total_laps, until)
        for driver, own in sorted(by_driver(laps).items())
    }
    pooled = compound_paces([pair for pairs in fits.values() for pair in pairs])
    return Paces(fuel, total_laps, fits, {c.compound: c for c in pooled})


def degradation(p: Paces, until: float | None) -> Degradation:
    return Degradation(
        until=until,
        total_laps=p.total_laps,
        fuel_per_lap=round(p.fuel, 4),
        stints=[
            StintPace(
                driver=driver,
                stint=stint.number,
                compound=stint.compound,
                start_lap=stint.start_lap,
                end_lap=stint.end_lap,
                fit=_deg_fit(fit),
            )
            for driver, pairs in p.fits.items()
            for stint, fit in pairs
        ],
        compounds=list(p.compounds.values()),
    )


# --- History -------------------------------------------------------------------------------------


def leader_line(per_driver: dict[str, list[Lap]]) -> list[float]:
    """Per lap: when the first car completed it."""
    first: dict[int, float] = {}
    for own in per_driver.values():
        for lap in own:
            if lap.end_time is not None:
                first[lap.lap] = min(lap.end_time, first.get(lap.lap, math.inf))
    return [first[n] for n in sorted(first)]


def pit_stops(own: list[Lap], status: list[StatusPeriod]) -> list[PitStop]:
    by_lap = {lap.lap: lap for lap in own}
    stops = []
    for lap in own:
        out_lap = by_lap.get(lap.lap + 1)
        if not lap.pit_in or lap.pit_in_time is None or out_lap is None:
            continue
        if out_lap.pit_out_time is None:
            continue
        stops.append(
            PitStop(
                lap=lap.lap,
                pit_in=lap.pit_in_time,
                pit_out=out_lap.pit_out_time,
                lane=round(out_lap.pit_out_time - lap.pit_in_time, 3),
                loss=_stop_loss(own, lap, out_lap),
                status=status_at(status, lap.pit_in_time),
            )
        )
    return stops


def _stop_loss(own: list[Lap], in_lap: Lap, out_lap: Lap) -> float | None:
    """In-lap plus out-lap against two laps at the driver's pace around the stop."""
    if in_lap.lap_time is None or out_lap.lap_time is None:
        return None
    window = range(in_lap.lap - STOP_REFERENCE_LAPS, out_lap.lap + STOP_REFERENCE_LAPS + 1)
    around = [lap.lap_time for lap in own if lap.lap in window and is_clean(lap)]
    if not around:
        return None
    return round(in_lap.lap_time + out_lap.lap_time - 2 * float(np.median(around)), 3)


def classification(per_driver: dict[str, list[Lap]], until: float | None) -> list[str]:
    """Most laps completed first, then who completed the last of them first."""

    def key(driver: str) -> tuple[int, float]:
        seen = [lap for lap in per_driver[driver] if done(lap, until) and lap.end_time is not None]
        if not seen:
            return (0, math.inf)
        return (-seen[-1].lap, seen[-1].end_time or math.inf)

    return sorted(per_driver, key=key)


def history(
    laps: list[Lap],
    kind: str,
    total_laps: int | None,
    grid: dict[str, int],
    status: list[StatusPeriod],
) -> RaceHistory:
    per_driver = by_driver(laps)
    leaders = leader_line(per_driver)
    race = kind == "race"
    drivers = []
    for driver in classification(per_driver, None):
        own = per_driver[driver]
        lines = [lap.end_time for lap in own]
        gaps = [
            round(line - leaders[lap.lap - 1], 3)
            if race and line is not None and lap.lap <= len(leaders)
            else None
            for lap, line in zip(own, lines, strict=True)
        ]
        drivers.append(
            DriverRace(
                driver=driver,
                grid=grid.get(driver),
                laps=[lap.lap for lap in own],
                line=lines,
                gap=gaps,
                position=[lap.position if race else None for lap in own],
                lap_time=[lap.lap_time for lap in own],
                tyre_life=[lap.tyre_life for lap in own],
                clean=[is_clean(lap) for lap in own],
                stints=stints(own),
                stops=pit_stops(own, status),
            )
        )
    return RaceHistory(
        kind=kind,  # type: ignore[arg-type]
        total_laps=total_laps,
        leader_line=leaders,
        drivers=drivers,
    )


# --- Pit window ----------------------------------------------------------------------------------


@dataclass
class TyreModel:
    """Predicted fuel-corrected lap times of one driver: on the current set and on a new one."""

    old: Fit
    new: Fit
    age: int
    """Age of the current set at the cutoff (laps)."""

    def stay(self, laps: int) -> float:
        """Time for the next `laps` laps on the current set."""
        return sum(self.old.at(self.age + j) for j in range(1, laps + 1))

    def fresh(self, laps: int) -> float:
        """Time for the first `laps` laps on the new set."""
        return sum(self.new.at(j) for j in range(1, laps + 1))


def first_gain(me: TyreModel, rival: TyreModel, later: int) -> float:
    """Seconds `me` gains on `rival` by stopping on the next lap while the rival stops `later` laps
    after, counted until both are on new tyres. The pit loss is the same for both and cancels."""
    mine = me.stay(1) + me.fresh(later + 1)
    theirs = rival.stay(later + 1) + rival.fresh(1)
    return theirs - mine


def tyre_model(
    p: Paces, driver: str, own: list[Lap], new_compound: str | None, notes: list[str]
) -> TyreModel | None:
    pairs = p.fits.get(driver) or []
    if not pairs:
        return None
    stint, fit = pairs[-1]
    seen = [lap for lap in own if stint.start_lap <= lap.lap <= stint.end_lap]
    age = next((lap.tyre_life for lap in reversed(seen) if lap.tyre_life is not None), None)
    if age is None:
        return None
    field = p.compounds.get(stint.compound or "")
    if fit is None:
        earlier = _earlier_fit(pairs)
        recent = [lap for lap in seen if is_clean(lap) and lap.tyre_life is not None][-3:]
        if field is not None and recent:
            # Too few clean laps on this set: the field's line, at this driver's latest pace.
            offsets = [
                (corrected(lap, p.fuel, p.total_laps) or 0.0)
                - field.base
                - field.slope * lap.tyre_life
                for lap in recent
            ]
            fit = Fit(field.slope, field.base + float(np.median(offsets)), 0.0, [])
            notes.append(
                f"{driver}: too few clean laps on this set, the field's degradation is used"
            )
        elif earlier is not None:
            # Just out of the pits: as quick as his last set was when new. Not the field's median
            # on this compound: early on that is whoever started on it (often the back).
            slope = field.slope if field is not None else earlier.slope
            fit = Fit(slope, earlier.base, 0.0, [])
            notes.append(f"{driver}: no clean lap on this set yet, as quick as his last set new")
        elif field is not None:
            fit = Fit(field.slope, field.base, 0.0, [])
            notes.append(f"{driver}: no clean lap of his own yet, the field's pace is used")
        else:
            return None
    target = p.compounds.get(new_compound or "")
    if target is None:
        new = Fit(fit.slope, fit.base, 0.0, [])
        if new_compound and new_compound != stint.compound:
            notes.append(
                f"No {new_compound} running yet: assumed as quick as a new {stint.compound}"
            )
    else:
        # The driver's own pace relative to the field, carried over to the new compound.
        offset = fit.base - field.base if field else 0.0
        new = Fit(target.slope, target.base + offset, 0.0, [])
    return TyreModel(old=fit, new=new, age=age)


def _earlier_fit(pairs: list[tuple[Stint, Fit | None]]) -> Fit | None:
    """The fit of the driver's last stint before this one that has one."""
    return next((fit for _, fit in reversed(pairs[:-1]) if fit is not None), None)


def pit_window(
    laps: list[Lap],
    p: Paces,
    driver: str,
    until: float | None,
    losses: dict[TrackStatus, float],
    status: TrackStatus,
    compound: str | None = None,
    live: bool = False,
) -> PitWindow:
    per_driver = by_driver(laps)
    if driver not in per_driver:
        raise LookupError(f"{driver} has no laps in this session")
    running = _running_cars(per_driver, until, live)
    if driver not in running:
        raise LookupError(f"{driver} is not running at that moment")
    seen = {d: [lap for lap in per_driver[d] if done(lap, until)] for d in running}
    leaders = leader_line({d: seen[d] for d in running})
    gap_now = {d: _gap(seen[d], leaders) for d in running}

    own = seen[driver]
    pairs = p.fits.get(driver) or []
    current = pairs[-1][0] if pairs else None
    current_compound = current.compound if current else None
    new_compound = compound or NEXT_COMPOUND.get(current_compound or "", current_compound)
    loss = losses.get(status, losses["green"])
    notes: list[str] = []
    models: dict[str, TyreModel | None] = {}

    def model(d: str) -> TyreModel | None:
        if d not in models:
            models[d] = tyre_model(p, d, seen[d], new_compound if d == driver else None, notes)
        return models[d]

    rejoin = None
    if gap_now[driver] is not None:
        rejoin = _rejoin(driver, gap_now[driver] + loss, gap_now)

    duels = []
    index = running.index(driver)
    for k, ahead in ((index - 1, True), (index + 1, False)):
        if not 0 <= k < len(running):
            continue
        rival = running[k]
        gap = _gap_between(seen[driver], seen[rival])
        me, them = model(driver), _rival_model(p, rival, seen[rival], notes)
        if gap is None or me is None or them is None:
            continue
        last = seen[rival][-1] if seen[rival] else None
        duels.append(
            Duel(
                rival=rival,
                ahead=ahead,
                gap=round(gap, 3),
                rival_compound=last.compound if last else None,
                rival_life=last.tyre_life if last else None,
                first=[round(first_gain(me, them, n), 3) for n in range(1, DUEL_LAPS + 1)],
                second=[round(-first_gain(them, me, n), 3) for n in range(1, DUEL_LAPS + 1)],
            )
        )
    last = own[-1] if own else None
    return PitWindow(
        driver=driver,
        lap=last.lap if last else 0,
        position=index + 1,
        compound=last.compound if last else current_compound,
        life=last.tyre_life if last else None,
        new_compound=new_compound,
        pit_loss=round(loss, 2),
        status=status,
        rejoin=rejoin,
        duels=duels,
        notes=list(dict.fromkeys(notes)),
    )


def _rival_model(p: Paces, rival: str, seen: list[Lap], notes: list[str]) -> TyreModel | None:
    """A rival goes to the same kind of set the guess gives for him."""
    pairs = p.fits.get(rival) or []
    compound = pairs[-1][0].compound if pairs else None
    return tyre_model(p, rival, seen, NEXT_COMPOUND.get(compound or "", compound), notes)


def _running_cars(
    per_driver: dict[str, list[Lap]], until: float | None, live: bool = False
) -> list[str]:
    """The cars still in the race at the cutoff, in classification order: on a lap that spans it.
    Without a cutoff the race is over: the cars on track when the leader takes the flag (a car
    that retired has an end time on its last lap too, so that is not enough)."""
    at = until if until is not None else _flag(per_driver)
    return [d for d in classification(per_driver, until) if _running(per_driver[d], at, live)]


def _flag(per_driver: dict[str, list[Lap]]) -> float | None:
    """When the leader crossed the line at the end of the last lap anyone completed."""
    ends = [(lap.lap, lap.end_time) for own in per_driver.values() for lap in own if lap.end_time]
    if not ends:
        return None
    last = max(n for n, _ in ends)
    return min(t for n, t in ends if n == last)


def _running(own: list[Lap], at: float | None, live: bool = False) -> bool:
    """On a lap that starts before `at` and ends after it. Live, the lap a car is on has no row
    until it is done: then its last line being recent is enough (as in the tower)."""
    if at is None:
        return False
    if any(
        lap.start_time is not None
        and lap.start_time <= at + LAP_DONE_SLACK
        and lap.end_time is not None
        and lap.end_time >= at - LAP_DONE_SLACK
        for lap in own
    ):
        return True
    last = max((lap.end_time for lap in own if lap.end_time is not None), default=None)
    return live and last is not None and last <= at and at - last < LIVE_RUNNING_FOR


def _gap(seen: list[Lap], leaders: list[float]) -> float | None:
    last = next((lap for lap in reversed(seen) if lap.end_time is not None), None)
    if last is None or last.lap > len(leaders):
        return None
    return last.end_time - leaders[last.lap - 1]


def _gap_between(a: list[Lap], b: list[Lap]) -> float | None:
    """Seconds between two cars at the last line both crossed."""
    lines_b = {lap.lap: lap.end_time for lap in b if lap.end_time is not None}
    for lap in reversed(a):
        if lap.end_time is not None and lap.lap in lines_b:
            return abs(lap.end_time - lines_b[lap.lap])
    return None


def _rejoin(driver: str, gap: float, gaps: dict[str, float | None]) -> Rejoin:
    others = sorted((g, d) for d, g in gaps.items() if d != driver and g is not None)
    ahead = [(g, d) for g, d in others if g <= gap]
    behind = [(g, d) for g, d in others if g > gap]
    front = ahead[-1] if ahead else None
    back = behind[0] if behind else None
    return Rejoin(
        position=len(ahead) + 1,
        ahead=front[1] if front else None,
        gap_ahead=round(gap - front[0], 3) if front else None,
        behind=back[1] if back else None,
        gap_behind=round(back[0] - gap, 3) if back else None,
    )


# --- Forecast ------------------------------------------------------------------------------------

DRY = {"SOFT", "MEDIUM", "HARD"}


def owes_stop(stints_so_far: list[Stint]) -> bool:
    """A dry race needs two compounds: one dry compound so far means a stop is still to come."""
    compounds = {s.compound for s in stints_so_far if s.compound}
    return len(compounds) == 1 and compounds <= DRY


def predicted_lines(
    model: TyreModel,
    start_line: float,
    last_lap: int,
    total: int,
    fuel: float,
    stop: int | None,
    loss: float,
    extra: float = 0.0,
) -> list[float]:
    """Predicted line times for laps last_lap + 1 … total (fuel-corrected times plus the fuel
    still on board), with a stop at the end of lap `stop` costing `loss` (a stop at last_lap
    has been made: the new set from the next lap on). `extra` goes on the first lap: the rest of
    a stop whose in-lap was the last one. Degradation never makes a set quicker here."""
    lines = []
    t = start_line
    for k, lap in enumerate(range(last_lap + 1, total + 1), start=1):
        if stop is None or lap <= stop:
            corrected_time = model.old.base + max(model.old.slope, 0.0) * (model.age + k)
        else:
            corrected_time = model.new.base + max(model.new.slope, 0.0) * (lap - stop)
        t += corrected_time + fuel * (total - lap) + (extra if k == 1 else 0.0)
        if stop is not None and lap == stop:
            t += loss
        lines.append(t)
    return lines


def assumed_stop(last_lap: int, total: int) -> int | None:
    """The in-lap assumed for a stop still owed: halfway to the flag. The tyre model is a straight
    line per set, and with that the quickest stop is always at one end of the race (now, or two
    laps from the flag), which no team does; halfway keeps the cost (the pit loss and the laps on
    a new set) without pretending to know the lap."""
    if total - last_lap < 3:
        return None
    return last_lap + (total - last_lap + 1) // 2


def forecast(
    laps: list[Lap], p: Paces, until: float | None, loss: float, live: bool = False
) -> Forecast:
    """Every running car from its last line to the flag on its own tyre model (TyreModel, plus the
    fuel still on board), with the stop it still owes at its quickest lap. The order at the flag
    and the gaps follow from the predicted line times; nobody is held up and nothing else
    happens (no safety car, no second stop)."""
    total = p.total_laps
    if not total:
        raise LookupError("The forecast is for races and sprints")
    per_driver = by_driver(laps)
    running = _running_cars(per_driver, until, live)
    seen = {d: [lap for lap in per_driver[d] if done(lap, until)] for d in running}
    leaders = leader_line({d: seen[d] for d in running})
    notes: list[str] = []
    lines: dict[str, list[float]] = {}
    """Per car its line times, lap 1 … total: the ones so far, then predicted."""
    stops: dict[str, tuple[int, str | None]] = {}
    for d in running:
        so_far = [lap.end_time for lap in seen[d] if lap.end_time is not None]
        last = next((lap for lap in reversed(seen[d]) if lap.end_time is not None), None)
        if last is None or last.end_time is None:
            continue
        if last.lap >= total:
            lines[d] = so_far
            continue
        pairs = p.fits.get(d) or []
        current = pairs[-1][0].compound if pairs else None
        compound = NEXT_COMPOUND.get(current or "", current)
        model = tyre_model(p, d, seen[d], compound, notes)
        if model is None:
            continue
        stop, extra = None, 0.0
        if last.pit_in:
            # In the pit lane now: the out-lap costs what the in-lap did not, then the new set.
            stop = last.lap
            pace = model.old.at(model.age) + p.fuel * (total - last.lap)
            extra = max(loss - max((last.lap_time or pace) - pace, 0.0), 0.0)
        elif owes_stop(stints(seen[d])):
            stop = assumed_stop(last.lap, total)
            if stop is not None:
                stops[d] = (stop, compound)
        lines[d] = so_far + predicted_lines(
            model, last.end_time, last.lap, total, p.fuel, stop, loss, extra
        )

    finishers = [lines[d][total - 1] for d in lines if len(lines[d]) >= total]
    flag = min(finishers) if finishers else math.inf

    def at_flag(d: str) -> tuple[int, float]:
        """Laps at the flag (a lapped car finishes the lap it is on when the winner is in), and
        the line time of the last one."""
        own = lines[d]
        count = min(sum(1 for t in own if t < flag - 1e-6) + 1, len(own))
        return count, own[count - 1]

    predicted = sorted(lines, key=lambda d: (-at_flag(d)[0], at_flag(d)[1]))
    unknown = [d for d in running if d not in lines]
    if unknown:
        notes.append(f"No pace yet for {', '.join(unknown)}: kept at their place now")
    order = predicted[:]
    for d in unknown:
        order.insert(min(running.index(d), len(order)), d)

    rows = []
    for position, d in enumerate(order, start=1):
        now = running.index(d) + 1
        stop_lap, stop_compound = stops.get(d, (None, None))
        row = ForecastRow(
            driver=d,
            position=position,
            now=now,
            gap=None,
            laps_down=0,
            stop_lap=stop_lap,
            stop_compound=stop_compound,
            passes=[],
        )
        if d in lines:
            count, at = at_flag(d)
            row.laps_down = total - count
            if row.laps_down == 0 and math.isfinite(flag):
                row.gap = round(at - flag, 3)
            # Cars ahead now that end up behind: the lap from which this car stays ahead.
            row.passes = [
                ForecastPass(driver=other, lap=_ahead_from(lines[d], lines[other]))
                for other in running[: now - 1]
                if other in lines and order.index(other) > position - 1
            ]
        rows.append(row)
    return Forecast(
        lap=sum(1 for t in leaders if until is None or t <= until + LAP_DONE_SLACK),
        total_laps=total,
        pit_loss=round(loss, 2),
        rows=rows,
        notes=list(dict.fromkeys(notes)),
    )


def _ahead_from(mine: list[float], theirs: list[float]) -> int:
    """The first lap from which `mine` crosses the line before `theirs` on every lap both run."""
    both = min(len(mine), len(theirs))
    lap = both
    for k in range(both - 1, -1, -1):
        if mine[k] >= theirs[k]:
            break
        lap = k + 1
    return lap


# --- Safety car calculator -----------------------------------------------------------------------


def pit_calculator(
    laps: list[Lap],
    until: float | None,
    losses: dict[TrackStatus, float],
    status: TrackStatus,
    live: bool = False,
) -> PitCalculator:
    """Per running car: where it rejoins if it alone stops now with the pit loss of `status`,
    on the gaps at the cutoff (under a safety car they shrink as the field bunches up)."""
    per_driver = by_driver(laps)
    running = _running_cars(per_driver, until, live)
    seen = {d: [lap for lap in per_driver[d] if done(lap, until)] for d in running}
    leaders = leader_line({d: seen[d] for d in running})
    gaps = {d: _gap(seen[d], leaders) for d in running}
    loss = losses.get(status, losses["green"])
    rows = []
    for position, d in enumerate(running, start=1):
        last = seen[d][-1] if seen[d] else None
        gap = gaps[d]
        in_lane = last is not None and last.pit_in
        rejoin = None if gap is None or in_lane else _rejoin(d, gap + loss, gaps)
        rows.append(
            PitNowRow(
                driver=d,
                position=position,
                compound=last.compound if last else None,
                life=last.tyre_life if last else None,
                owes_stop=owes_stop(stints(seen[d])),
                in_pit=in_lane,
                rejoin=rejoin,
                places=rejoin.position - position if rejoin else None,
            )
        )
    return PitCalculator(
        lap=sum(1 for t in leaders if until is None or t <= until + LAP_DONE_SLACK),
        status=status,
        loss=round(loss, 2),
        green_loss=round(losses["green"], 2),
        rows=rows,
    )
