import numpy as np

from app import passes
from app.replay import Track
from app.schemas import Corner, OvertakeCheck
from tests.test_replay import make_lap

STEP = 0.25
LENGTH = 5000.0
LAP = 80.0  # seconds
T = np.arange(0.0, 10 * LAP, STEP)


def track(*progress: np.ndarray) -> Track:
    drivers = ["AAA", "BBB", "CCC"][: len(progress)]
    p = np.vstack(progress)
    return Track(
        start=0.0,
        step=STEP,
        lap_length=LENGTH,
        drivers=drivers,
        x=np.zeros_like(p),
        y=np.zeros_like(p),
        progress=p,
    )


def steady(offset_m: float = 0.0, rate: float = 1.0) -> np.ndarray:
    """Laps driven at constant pace, `offset_m` metres ahead."""
    return T / LAP * rate + offset_m / LENGTH


def laps_for(*drivers: str, **kw) -> list:
    return [
        make_lap(d, n, lap_time=LAP, start_time=(n - 1) * LAP, end_time=n * LAP, **kw)
        for d in drivers
        for n in range(1, 11)
    ]


def run(t: Track, laps=None, checks=None, on=()):
    corners = [
        Corner(label=str(i + 1), distance=d, x=0, y=0, angle=0)
        for i, d in enumerate((800, 2500, 4200))
    ]
    return passes.passes(t, laps or laps_for(*t.drivers), [], [], corners, 1.0, checks, list(on))


def test_a_clean_pass() -> None:
    ahead = steady(60.0)
    behind = steady(0.0)
    # BBB closes 2 m/s from lap 3 and gets 60 m ahead.
    gain = np.clip((T - 3 * LAP) * 2.0, 0, 120.0) / LENGTH
    [found] = run(track(ahead, behind + gain))
    assert (found.driver, found.passed, found.lap) == ("BBB", "AAA", 4)
    # Level after 30 s of closing at 2 m/s.
    assert abs(found.time - (3 * LAP + 30.0)) < 0.5
    assert found.position == 1
    assert found.overtake_mode is None


def test_nose_to_tail_noise_is_no_pass() -> None:
    """10 m apart with the position estimate's error: smooth, ~12 m, plus a little jitter."""
    rng = np.random.default_rng(3)
    error = 12.0 * np.sin(2 * np.pi * T / 20) + rng.normal(0, 3, len(T))
    ahead = steady(10.0) + error / LENGTH
    assert run(track(ahead, steady(0.0))) == []


def test_side_by_side_counts_once() -> None:
    ahead = steady(40.0)
    gain = np.clip((T - 3 * LAP) * 2.0, 0, 80.0) / LENGTH
    wobble = np.where((T > 3 * LAP + 18) & (T < 3 * LAP + 22), 30.0 / LENGTH, 0.0)
    assert len(run(track(ahead, steady(0.0) + gain + wobble))) == 1


def test_lapping_is_no_pass() -> None:
    leader = steady(0.0, rate=1.0)
    # Half a lap up the road but a lap down: the leader catches him and goes by.
    backmarker = steady(0.0, rate=0.9) - 0.5
    assert run(track(leader, backmarker)) == []


def test_not_around_a_pit_stop() -> None:
    ahead = steady(60.0)
    gain = np.clip((T - 3 * LAP) * 2.0, 0, 120.0) / LENGTH
    laps = laps_for("BBB")
    laps += [
        make_lap("AAA", n, lap_time=LAP, start_time=(n - 1) * LAP, end_time=n * LAP)
        for n in range(1, 11)
    ]
    # AAA stops on lap 4: in at 4:25, out at 4:50 (the pass is at 4:30).
    laps = [
        lap.model_copy(update={"pit_in_time": 3 * LAP + 25})
        if (lap.driver, lap.lap) == ("AAA", 4)
        else lap.model_copy(update={"pit_out_time": 3 * LAP + 50})
        if (lap.driver, lap.lap) == ("AAA", 5)
        else lap
        for lap in laps
    ]
    assert run(track(ahead, steady(0.0) + gain), laps) == []


def test_a_stopped_car_is_not_passed() -> None:
    ahead = np.minimum(steady(60.0), 3.5)  # stops halfway round lap 4
    assert run(track(ahead, steady(0.0))) == []


def test_with_overtake_mode() -> None:
    ahead = steady(60.0)
    gain = np.clip((T - 3 * LAP) * 2.0, 0, 120.0) / LENGTH
    check = OvertakeCheck(
        driver="BBB", lap=4, time=3 * LAP + 10, ahead="AAA", gap=0.8, enabled=True, within=True
    )
    [found] = run(track(ahead, steady(0.0) + gain), checks=[check], on=[(0.0, np.inf)])
    assert found.overtake_mode is True
    [found] = run(track(ahead, steady(0.0) + gain), checks=[], on=[(0.0, np.inf)])
    assert found.overtake_mode is False


def test_the_corner_it_went_into() -> None:
    corners = [
        Corner(label=str(i + 1), distance=d, x=0, y=0, angle=0) for i, d in enumerate((800, 2500))
    ]
    assert passes.corner_into(700, corners, 1.0) == "T1"
    assert passes.corner_into(900, corners, 1.0) == "T1"
    assert passes.corner_into(1200, corners, 1.0) == "T2"
