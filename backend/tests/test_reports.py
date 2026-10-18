import pytest

from app import reports, strategy
from app.schemas import StatusPeriod
from tests.test_replay import make_lap

GREEN = [StatusPeriod(start=0.0, end=10_000.0, status="green")]


def driver_race(driver: str, times: list[float], stops: tuple[int, ...] = (), **kw):
    """Back-to-back laps; a stop on lap n makes n the in-lap and n + 1 the out-lap."""
    out, t, stint = [], 0.0, 1
    for n, time in enumerate(times, start=1):
        fields = {"track_status": "1", "compound": "MEDIUM", "stint": stint, "tyre_life": n}
        if n in stops:
            fields |= {"pit_in": True, "pit_in_time": t + time - 10}
        if n - 1 in stops:
            stint += 1
            fields |= {"pit_out": True, "pit_out_time": t + 10, "stint": stint}
        out.append(
            make_lap(driver, n, lap_time=time, start_time=t, end_time=t + time, **(fields | kw))
        )
        t += time
    return out


def test_undercut_that_worked():
    # NOR 2 s behind VER pits first and comes out on quicker tyres; VER pits two laps later.
    ver = driver_race("VER", [80.0] * 6 + [90.0, 92.0, 80.0, 80.0], stops=(7,))
    nor = driver_race("NOR", [80.5] * 4 + [90.0, 92.0] + [78.0] * 4, stops=(5,))
    history = strategy.history(ver + nor, "race", 10, {"VER": 1, "NOR": 2}, GREEN)
    [moment] = reports.undercuts(history)
    assert (moment.driver, moment.other, moment.lap) == ("NOR", "VER", 8)
    assert moment.action.t is not None and moment.action.t < moment.t


def test_no_undercut_when_the_gap_was_big():
    ver = driver_race("VER", [80.0] * 6 + [90.0, 92.0, 80.0, 80.0], stops=(7,))
    nor = driver_race("NOR", [81.0] * 4 + [90.0, 92.0] + [76.0] * 4, stops=(5,))
    history = strategy.history(ver + nor, "race", 10, {"VER": 1, "NOR": 2}, GREEN)
    assert reports.undercuts(history) == []  # 4 s behind: not a fight


def test_start_moves_and_stop_extremes():
    laps = (
        driver_race("VER", [80.0] * 6, stops=(3,), position=3)
        + driver_race("NOR", [80.1] * 6, stops=(4,), position=4)
        + driver_race("PIA", [79.0] + [80.2] * 5, position=1)
        + driver_race("LEC", [79.5] + [80.3] * 5, position=2)
    )
    history = strategy.history(laps, "race", 6, {"VER": 1, "NOR": 2, "LEC": 3, "PIA": 4}, GREEN)
    [start] = reports.start_moves(history)
    assert (start.driver, start.value) == ("PIA", 3.0)
    fast, slow = reports.stop_extremes(history)
    assert fast.kind == "fast_stop" and slow.kind == "slow_stop"
    assert fast.value <= slow.value


def test_flags_with_laps():
    status = [
        StatusPeriod(start=0.0, end=250.0, status="green"),
        StatusPeriod(start=250.0, end=420.0, status="sc"),
        StatusPeriod(start=420.0, end=900.0, status="green"),
    ]
    [sc] = reports.flags(status, [80.0, 160.0, 240.0, 330.0, 430.0, 510.0])
    assert (sc.status, sc.lap, sc.until_lap, sc.value) == ("sc", 4, 5, 170.0)


def test_long_runs_in_practice():
    # LEC: 6 laps at pace on one set; NOR: a short run (3 laps) and a cool-down lap.
    lec = driver_race("LEC", [92.0] + [84.0 + 0.05 * i for i in range(6)] + [95.0], stint=1)
    nor = driver_race("NOR", [92.0, 83.0, 83.2, 83.1, 110.0], stint=1)
    nor[-1] = nor[-1].model_copy(update={"pit_in": True})
    ver = driver_race("VER", [92.0] + [83.8 + 0.1 * i for i in range(7)], stint=1)
    runs = reports.long_runs(lec + nor + ver)
    assert [r.driver for r in runs] == ["VER", "LEC"]
    lec_run = runs[1]
    assert lec_run.laps == 6 and lec_run.slope == pytest.approx(0.05, abs=1e-6)
    # The click compares LEC's typical lap with the quickest run's (VER).
    assert lec_run.action.laps[0].startswith("VER:")
    assert lec_run.action.laps[1].startswith("LEC:")
