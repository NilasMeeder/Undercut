"""Top speed against cornering speed (app/setups.py)."""

import pytest

from app import analysis, setups


def segment(*minimums: float) -> analysis.CornerSegment:
    laps = [analysis.CornerStats(1.0, None, v, 0.0, None, 300.0) for v in minimums]
    return analysis.CornerSegment("T1", 0.0, 100.0, laps)


def test_corners_split_on_the_reference_laps_minimum() -> None:
    # Reference (lap 0) is 90 and 140 in the slow ones, 200 in the fast one.
    segments = [segment(90, 95), segment(140, 160), segment(200, 190)]
    assert setups.corner_speeds(segments, 1) == pytest.approx((127.5, 190.0))
    assert setups.corner_speeds([segment(200, 210)], 1) == (None, 210.0)
