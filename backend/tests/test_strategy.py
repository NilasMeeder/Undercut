import pytest

from app import strategy
from app.schemas import StatusPeriod
from tests.test_replay import make_lap

GREEN = [StatusPeriod(start=0.0, end=10_000.0, status="green")]


def stint_laps(driver: str, laps: range, base: float, slope: float, start: float = 0.0, **kw):
    """Laps with time = base + slope × tyre age, back to back from `start`."""
    out, t = [], start
    for age, n in enumerate(laps, start=1):
        time = round(base + slope * age, 3)
        out.append(
            make_lap(
                driver,
                n,
                lap_time=time,
                tyre_life=age,
                start_time=t,
                end_time=t + time,
                track_status="1",
                stint=1,
                compound="MEDIUM",
                **kw,
            )
        )
        t += time
    return out


def test_fit_recovers_degradation_and_drops_outliers() -> None:
    ages = list(range(1, 13))
    times = [80.0 + 0.05 * a for a in ages]
    times[5] += 3.0  # stuck in traffic
    fit = strategy.fit_line(ages, times, list(range(2, 14)))
    assert fit is not None
    assert fit.slope == pytest.approx(0.05, abs=1e-6)
    assert fit.base == pytest.approx(80.0, abs=1e-6)
    assert 7 not in fit.laps and len(fit.laps) == 11


def test_fit_needs_enough_laps() -> None:
    assert strategy.fit_line([1, 2, 3], [80.0, 80.1, 80.2], [2, 3, 4]) is None


def test_fuel_correction_takes_out_the_fuel_burn() -> None:
    fuel = strategy.fuel_per_lap(50, 0.03)
    assert fuel == pytest.approx(0.06)
    # 10 laps from the end, carrying 0.6 s worth of fuel more than on the last lap.
    lap = make_lap("VER", 40, lap_time=81.0)
    assert strategy.corrected(lap, fuel, 50) == pytest.approx(80.4)


def test_clean_laps_leave_out_pit_laps_lap_one_and_safety_cars() -> None:
    def lap(**kw):
        return make_lap("VER", kw.pop("n", 5), lap_time=80.0, **({"track_status": "1"} | kw))

    assert strategy.is_clean(lap())
    assert strategy.is_clean(lap(track_status="12"))  # a yellow somewhere is still racing
    assert not strategy.is_clean(lap(n=1))
    assert not strategy.is_clean(lap(pit_in=True))
    assert not strategy.is_clean(lap(track_status="14"))  # safety car
    assert not strategy.is_clean(lap(track_status="16"))  # VSC


def test_cool_down_laps_stay_out_of_the_fit() -> None:
    """Practice and qualifying: a push lap every other lap, cool-down laps in between."""
    laps = stint_laps("VER", range(1, 13), 80.0, 0.05)
    for i in range(1, 12, 2):
        laps[i] = laps[i].model_copy(update={"lap_time": 100.0})
    p = strategy.paces(laps, None, 0.0, None)
    [(_, fit)] = p.fits["VER"]
    assert fit is not None and fit.slope == pytest.approx(0.05, abs=1e-3)
    assert all(n % 2 == 1 for n in fit.laps)
    # With the practice fuel assumption the fuel burn comes back on top of the tyre wear.
    p = strategy.paces(laps, None, 0.03, None)
    [(_, fit)] = p.fits["VER"]
    assert fit is not None and fit.slope == pytest.approx(0.05 + 0.054, abs=1e-3)


def test_degradation_per_stint_with_the_cutoff() -> None:
    laps = stint_laps("VER", range(1, 21), 80.0, 0.05)
    full = strategy.paces(laps, None, 0.0, None)
    [(stint, fit)] = full.fits["VER"]
    assert (stint.start_lap, stint.end_lap, stint.compound) == (1, 20, "MEDIUM")
    assert fit is not None and fit.slope == pytest.approx(0.05, abs=1e-3)
    # Only the laps completed by the cutoff: the stint so far.
    cut = strategy.paces(laps, None, 0.0, laps[9].end_time)
    [(stint, _)] = cut.fits["VER"]
    assert stint.end_lap == 10


def two_stop_race():
    """VER pits on lap 5 (in-lap +10 s, out-lap +12 s); NOR runs 0.5 s/lap slower, no stop."""
    ver = stint_laps("VER", range(1, 11), 80.0, 0.0)
    ver[4] = ver[4].model_copy(update={"pit_in": True, "pit_in_time": 400.0, "lap_time": 90.0})
    ver[5] = ver[5].model_copy(
        update={"pit_out": True, "pit_out_time": 420.0, "lap_time": 92.0, "stint": 2}
    )
    t = 0.0
    for i, lap in enumerate(ver):
        ver[i] = lap.model_copy(update={"start_time": t, "end_time": t + lap.lap_time})
        t += lap.lap_time
    nor = stint_laps("NOR", range(1, 11), 80.5, 0.0)
    return ver + nor


def test_history_has_gaps_positions_and_stops() -> None:
    history = strategy.history(two_stop_race(), "race", 10, {"VER": 1, "NOR": 2}, GREEN)
    assert history.leader_line[0] == 80.0
    nor = next(d for d in history.drivers if d.driver == "NOR")
    assert nor.gap[:2] == [pytest.approx(0.5), pytest.approx(1.0)]
    assert nor.grid == 2
    ver = next(d for d in history.drivers if d.driver == "VER")
    [stop] = ver.stops
    assert (stop.lap, stop.lane, stop.status) == (5, 20.0, "green")
    assert stop.loss == pytest.approx(22.0)  # 10 + 12 s over two laps at 80.0
    assert [s.start_lap for s in ver.stints] == [1, 6]
    assert ver.clean[:6] == [False, True, True, True, False, False]  # lap 1, in-lap, out-lap
    # VER lost 22 s, NOR gains 0.5 s a lap less: NOR leads from lap 6 on.
    assert history.drivers[0].driver == "NOR"


def model(base: float, slope: float, new_base: float, age: int) -> strategy.TyreModel:
    return strategy.TyreModel(
        old=strategy.Fit(slope, base, 0.0, []), new=strategy.Fit(slope, new_base, 0.0, []), age=age
    )


def test_undercut_gain_is_the_tyre_advantage() -> None:
    me = model(80.0, 0.1, 80.0, age=20)
    rival = model(80.0, 0.1, 80.0, age=20)
    # Both identical: stopping first gains the rival's lap on old tyres (age 22) against my second
    # lap on new ones (age 2): 0.1 × 20 s.
    assert strategy.first_gain(me, rival, 1) == pytest.approx(2.0)
    # Waiting longer makes it worse for the rival.
    assert strategy.first_gain(me, rival, 2) > strategy.first_gain(me, rival, 1)


def test_no_degradation_no_undercut() -> None:
    me = model(80.0, 0.0, 80.0, age=20)
    assert strategy.first_gain(me, model(80.0, 0.0, 80.0, age=20), 1) == pytest.approx(0.0)


def test_pit_window_rejoin_and_duels() -> None:
    laps = stint_laps("VER", range(1, 21), 80.0, 0.05)
    laps += stint_laps("NOR", range(1, 21), 80.2, 0.05)
    laps += stint_laps("PIA", range(1, 21), 83.0, 0.05)  # 3 s a lap slower: 30 s back
    until = laps[49].end_time  # PIA completes lap 10; VER and NOR are on lap 11
    p = strategy.paces(laps, None, 0.0, until)
    losses = {"green": 25.0, "sc": 15.0, "vsc": 18.0, "vsc_ending": 18.0, "red": 0.0}
    window = strategy.pit_window(laps, p, "NOR", until, losses, "green")
    assert window.position == 2
    assert window.new_compound == "HARD"
    assert window.notes  # nobody ran the HARD yet
    # After 10 laps NOR is 2 s behind VER and PIA 30 s: with 25 s loss NOR stays ahead of PIA.
    rejoin = window.rejoin
    assert rejoin is not None
    assert (rejoin.position, rejoin.ahead, rejoin.behind) == (2, "VER", "PIA")
    assert rejoin.gap_behind == pytest.approx(3.0, abs=0.01)
    [ver, pia] = window.duels
    assert (ver.rival, ver.ahead, pia.rival, pia.ahead) == ("VER", True, "PIA", False)
    assert ver.gap == pytest.approx(2.0, abs=0.01)
    assert len(ver.first) == strategy.DUEL_LAPS
    sc = strategy.pit_window(laps, p, "NOR", until, losses, "sc")
    assert sc.pit_loss == 15.0


def test_forecast_projects_the_pace_with_the_stop_still_owed() -> None:
    laps = stint_laps("VER", range(1, 21), 80.3, 0.05)
    laps += stint_laps("NOR", range(1, 21), 80.0, 0.05, start=5.0)  # 0.3 s a lap quicker
    laps += stint_laps("PIA", range(1, 21), 83.0, 0.05)
    until = next(lap.end_time for lap in laps if lap.driver == "VER" and lap.lap == 10)
    until += 3.0  # NOR has done lap 10 too (2 s behind)
    p = strategy.paces(laps, 20, 0.0, until)
    result = strategy.forecast(laps, p, until, 25.0)
    assert result.lap == 10 and result.total_laps == 20
    nor, ver, pia = result.rows
    assert (nor.driver, nor.now, ver.driver, ver.now, pia.driver) == ("NOR", 2, "VER", 1, "PIA")
    # One compound so far: everyone still stops, assumed halfway to the flag.
    assert {r.stop_lap for r in result.rows} == {15}
    assert ver.gap == pytest.approx(1.0, abs=0.01)  # NOR gains 3 s over the last 10 laps
    assert [(x.driver, x.lap) for x in nor.passes] == [("VER", 17)]
    assert ver.passes == [] and pia.laps_down == 0


def test_after_the_flag_a_retired_car_is_not_running() -> None:
    laps = stint_laps("VER", range(1, 21), 80.0, 0.05)
    laps += stint_laps("NOR", range(1, 20), 88.0, 0.05)  # a lap down, still on track at the flag
    laps += stint_laps("PIA", range(1, 6), 80.2, 0.05)
    # PIA's last lap has no time but does end: how FastF1 leaves a retirement lap.
    laps[-1] = laps[-1].model_copy(update={"lap_time": None})
    p = strategy.paces(laps, 20, 0.0, None)
    assert [r.driver for r in strategy.forecast(laps, p, None, 25.0).rows] == ["VER", "NOR"]
    assert strategy.forecast(laps, p, None, 25.0).rows[1].laps_down == 1


def test_live_a_car_on_its_lap_without_a_row_yet_is_running() -> None:
    laps = stint_laps("VER", range(1, 11), 80.0, 0.05)
    laps += stint_laps("NOR", range(1, 10), 80.2, 0.05)  # lap 10 not done yet
    until = laps[9].end_time  # VER's tenth line
    losses = {"green": 25.0, "sc": 15.0, "vsc": 18.0, "vsc_ending": 18.0, "red": 0.0}
    rows = strategy.pit_calculator(laps, until, losses, "sc", live=True).rows
    assert [r.driver for r in rows] == ["VER", "NOR"]
    p = strategy.paces(laps, 20, 0.0, None)
    forecast = strategy.forecast(laps, p, None, 25.0, live=True)
    assert {r.driver for r in forecast.rows} == {"VER", "NOR"}
    # In the archive every lap has its row: no row means no longer in the race.
    assert [r.driver for r in strategy.pit_calculator(laps, until, losses, "sc").rows] == ["VER"]


def test_pit_calculator_rejoins_everyone_with_the_safety_car_loss() -> None:
    laps = stint_laps("VER", range(1, 21), 80.0, 0.05)
    laps += stint_laps("NOR", range(1, 21), 80.2, 0.05)
    laps += stint_laps("PIA", range(1, 21), 83.0, 0.05)  # 30 s back after 10 laps
    until = laps[49].end_time
    losses = {"green": 25.0, "sc": 15.0, "vsc": 18.0, "vsc_ending": 18.0, "red": 0.0}
    calc = strategy.pit_calculator(laps, until, losses, "sc")
    assert (calc.status, calc.loss, calc.green_loss, calc.lap) == ("sc", 15.0, 25.0, 10)
    ver, nor, pia = calc.rows
    assert ver.owes_stop and not ver.in_pit and ver.rejoin is not None
    # VER 15 s down lands behind NOR (2 s back) but ahead of PIA (30 s back).
    assert (ver.rejoin.position, ver.places, ver.rejoin.behind) == (2, 1, "PIA")
    assert nor.rejoin is not None and nor.places == 0
    assert pia.rejoin is not None and pia.places == 0
    green = strategy.pit_calculator(laps, until, losses, "green")
    assert green.rows[0].rejoin is not None and green.rows[0].rejoin.gap_behind == pytest.approx(
        5.0, abs=0.01
    )
