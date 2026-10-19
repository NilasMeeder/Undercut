import numpy as np

from app.overtake import Passage, checks, passages
from app.replay import Track
from app.schemas import TimeRange


def track(progress: list[list[float]], drivers: list[str]) -> Track:
    rows = np.array(progress, dtype=float)
    return Track(
        start=100.0,
        step=1.0,
        lap_length=5000.0,
        drivers=drivers,
        x=np.zeros_like(rows),
        y=np.zeros_like(rows),
        progress=rows,
    )


def test_a_crossing_is_interpolated_between_samples() -> None:
    found = passages(track([[0.6, 0.8, 1.0, 1.6, 1.8, 2.0]], ["VER"]), fraction=0.7)
    assert [(p.lap, round(p.time, 3)) for p in found] == [(1, 100.5), (2, 103.5)]


def test_unknown_samples_and_the_grid_are_not_crossings() -> None:
    # Off the track (NaN) across the line, and the grid behind the line (lap 0).
    found = passages(track([[-0.05, 0.1, np.nan, 1.2, 1.5]], ["NOR"]), fraction=0.98)
    assert found == []


def test_the_gap_is_to_whichever_car_crossed_before() -> None:
    found = [
        Passage("VER", 5, 10.0),
        Passage("NOR", 5, 10.8),
        Passage("PIA", 5, 12.0),
        Passage("LEC", 4, 12.5),
    ]
    out = checks(found, [TimeRange(start=0.0, end=12.2)])
    assert [(c.driver, c.ahead, c.gap, c.within, c.enabled) for c in out] == [
        ("VER", None, None, False, True),
        ("NOR", "VER", 0.8, True, True),
        ("PIA", "NOR", 1.2, False, True),
        # A lapped car counts as the car ahead too; race control disabled it by then.
        ("LEC", "PIA", 0.5, True, False),
    ]
