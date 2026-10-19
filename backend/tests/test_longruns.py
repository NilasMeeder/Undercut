import pytest

from app import longruns, strategy
from tests.test_reports import driver_race


def test_runs_per_compound_with_gap_and_fuel():
    # LEC: 6 laps at pace on a medium (one slow lap in it); VER 7 on a medium; NOR a soft run.
    lec = driver_race("LEC", [92.0] + [84.0, 84.05, 90.0, 84.15, 84.2, 84.25, 84.3] + [95.0])
    ver = driver_race("VER", [92.0] + [83.8 + 0.1 * i for i in range(7)])
    nor = driver_race("NOR", [92.0] + [83.0 + 0.2 * i for i in range(5)], compound="SOFT")
    runs = longruns.find_runs(lec + ver + nor, "FP2")
    assert [(r.driver, r.compound) for r in runs] == [
        ("NOR", "SOFT"),
        ("VER", "MEDIUM"),
        ("LEC", "MEDIUM"),
    ]
    nor_run, ver_run, lec_run = runs
    assert nor_run.gap == 0.0 and ver_run.gap == 0.0
    assert lec_run.gap == pytest.approx(lec_run.median - ver_run.median, abs=1e-6)
    # The slow lap is a hole in the times, not the end of the run.
    assert (lec_run.start_lap, lec_run.end_lap, lec_run.laps) == (2, 8, 6)
    assert lec_run.times[2] is None and len(lec_run.times) == 7
    # deg = the raw slope plus the burn the lighter car hides.
    burn = strategy.fuel_per_lap(None, strategy.FUEL_EFFECT)
    assert ver_run.slope == pytest.approx(0.1, abs=1e-6)
    assert ver_run.deg == pytest.approx(0.1 + burn, abs=1e-3)
    assert ver_run.used == 0 and ver_run.open


def test_a_run_counts_up_to_the_cutoff_and_closes_at_the_in_lap():
    ver = driver_race("VER", [92.0] + [84.0] * 6 + [100.0])
    ver[-1] = ver[-1].model_copy(update={"pit_in": True})
    [closed] = longruns.find_runs(ver, "FP2")
    assert not closed.open
    # At the end of lap 5 only four laps at pace are done: not yet a long run.
    assert longruns.find_runs(ver, "FP2", until=ver[4].end_time) == []
    [running] = longruns.find_runs(ver, "FP2", until=ver[5].end_time)
    assert running.laps == 5 and running.open


def test_used_set_and_short_runs():
    # A set with 3 laps on it already; a stint of 4 laps at pace is no long run.
    used = driver_race("ALB", [92.0] + [84.0] * 5, tyre_life=4)
    short = driver_race("SAI", [92.0] + [84.0] * 4)
    [run] = longruns.find_runs(used + short, "FP1")
    assert run.driver == "ALB" and run.used == 3


def test_push_laps_with_cool_laps_are_no_long_run():
    # Push, cool, push, cool…: five laps at pace, but half the stint is cooling.
    times = [92.0] + [83.0, 100.0] * 5
    assert longruns.find_runs(driver_race("RUS", times), "FP2") == []


def test_two_slow_laps_in_a_row_end_a_run():
    # Two pushes, then two cool laps, then a run of six: the run starts after the break.
    times = [92.0, 82.5, 82.6, 100.0, 100.0] + [84.0] * 6
    [run] = longruns.find_runs(driver_race("HAM", times), "FP2")
    assert (run.start_lap, run.laps) == (6, 6)
