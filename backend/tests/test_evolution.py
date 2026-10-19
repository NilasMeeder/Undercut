import numpy as np
import pytest

from app import evolution
from tests.test_replay import make_lap

LEVELS = {"VER": 78.8, "NOR": 78.9, "LEC": 79.0, "HAM": 79.2, "ALB": 79.5}


def track(t: float) -> float:
    """The made-up track: 0.8 s quicker over the hour, most of it early."""
    return -0.8 * (1 - np.exp(-t / 1200)) / (1 - np.exp(-3600 / 1200))


def session(noise: float = 0.0, seed: int = 1) -> list:
    """Every driver a push lap, a cool-down lap and an in-lap, every 6 minutes for an hour."""
    rng = np.random.default_rng(seed)
    laps = []
    for k, (driver, level) in enumerate(LEVELS.items()):
        n = 1
        for run, start in enumerate(np.arange(60.0 + k * 20, 3600, 360)):
            laps.append(make_lap(driver, n, lap_time=90.0, end_time=start, pit_out=True))
            push = level + track(start + 45) + rng.normal(0, noise)
            laps.append(
                make_lap(
                    driver,
                    n + 1,
                    lap_time=round(push, 3),
                    end_time=start + push,
                    compound="SOFT",
                    tyre_life=2,
                    track_status="1",
                )
            )
            laps.append(
                make_lap(driver, n + 2, lap_time=100.0, end_time=start + push + 100, pit_in=True)
            )
            n += 3
            assert run < 20
    return laps


def made_up_gain(result) -> float:
    """What the made-up track gained between the first push lap and the last."""
    return track(result.times[0]) - track(result.times[-1])


def test_recovers_the_track() -> None:
    result = evolution.evolution(session())
    # Without noise the smoothing shows: it rounds off the steep start a little.
    assert result.total == pytest.approx(made_up_gain(result), abs=0.08)
    assert result.gain[0] == 0.0
    # Quicker early than late, as made up.
    half = len(result.gain) // 2
    assert result.gain[half] > 0.5 * result.total
    assert result.spread < 0.02


def test_best_lap_worth_on_the_last_track() -> None:
    result = evolution.evolution(session())
    by = {d.driver: d for d in result.drivers}
    # Everyone's best lap is the last one, so each is worth his own level on the last track.
    for driver, level in LEVELS.items():
        assert by[driver].worth == pytest.approx(level + track(by[driver].time), abs=0.05)
    assert [d.driver for d in result.drivers] == list(LEVELS)


def test_an_early_lap_is_worth_more_later() -> None:
    laps = session()
    # VER's last runs go wrong: his best is an early lap.
    late = [
        lap
        for lap in laps
        if lap.driver == "VER" and lap.compound == "SOFT" and (lap.end_time or 0) > 1500
    ]
    laps = [
        lap.model_copy(update={"lap_time": (lap.lap_time or 0) + 0.6}) if lap in late else lap
        for lap in laps
    ]
    result = evolution.evolution(laps)
    ver = next(d for d in result.drivers if d.driver == "VER")
    assert ver.time < 1500
    assert ver.worth == pytest.approx(LEVELS["VER"] + track(result.times[-1]), abs=0.05)
    assert ver.worth < ver.lap_time - 0.2


def test_noise_and_a_bad_lap_do_not_pull_the_curve() -> None:
    laps = session(noise=0.1)
    i = next(i for i, lap in enumerate(laps) if lap.driver == "HAM" and lap.compound == "SOFT")
    laps[i] = laps[i].model_copy(update={"lap_time": (laps[i].lap_time or 0) + 2.0})
    result = evolution.evolution(laps)
    assert result.total == pytest.approx(made_up_gain(result), abs=0.15)


def test_only_laps_done_by_until() -> None:
    result = evolution.evolution(session(), until=1800.0)
    assert max(p.time for p in result.points) < 1800
    assert result.total == pytest.approx(made_up_gain(result), abs=0.05)


def test_needs_push_laps() -> None:
    with pytest.raises(LookupError):
        evolution.evolution(session(), until=300.0)


def test_leaves_out_pit_laps_slow_laps_and_wet_tyres() -> None:
    laps = session()
    wet = make_lap("VER", 99, lap_time=79.0, end_time=2000.0, compound="INTERMEDIATE")
    yellow = make_lap("VER", 98, lap_time=79.0, end_time=2100.0, compound="SOFT", track_status="12")
    used = {(p.driver, p.lap) for p in evolution.push_laps([*laps, wet, yellow])}
    assert ("VER", 99) not in used and ("VER", 98) not in used
    assert all(n % 3 == 2 for _, n in used)


def test_only_qualifying() -> None:
    with pytest.raises(LookupError):
        evolution.get_evolution(2025, 16, "FP1")
