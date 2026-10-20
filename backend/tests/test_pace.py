import pytest

from app import pace

NOISE = [0.05, -0.1, 0.0, 0.1, -0.05, 0.08, -0.08, 0.02, -0.02, 0.06, -0.06, 0.04]


def test_pace_step_quicker_and_not_a_ramp():
    laps = list(range(10, 22))
    step = [(0.6 if n < 16 else -0.4) + e for n, e in zip(laps, NOISE, strict=True)]
    assert pace.step(laps, step) == (16, pytest.approx(-1.0, abs=0.1))
    # Degradation of 0.1 s a lap is the stint's own trend, not a step.
    ramp = [0.1 * (n - 10) + e for n, e in zip(laps, NOISE, strict=True)]
    assert pace.step(laps, ramp) is None
    # A single slow lap (traffic) is left out, not a change.
    one = [e + (3.0 if n == 15 else 0.0) for n, e in zip(laps, NOISE, strict=True)]
    assert pace.step(laps, one) is None


def test_a_shorter_window_for_short_runs():
    laps = list(range(2, 10))
    step = [(0.0 if n < 6 else 1.5) + e for n, e in zip(laps, NOISE, strict=False)]
    assert pace.step(laps, step) is None  # fewer than 5 laps on either side
    assert pace.step(laps, step, window=4) == (6, pytest.approx(1.5, abs=0.15))
