import numpy as np
import pytest

from app import analysis
from app.analysis import LapTrace, compare, make_grid, mini_sectors, resample


def constant_speed_lap(length: float, speed: float, samples: int = 200) -> LapTrace:
    distance = np.linspace(0.0, length, samples)
    return LapTrace(
        distance=distance,
        time=distance / speed,
        channels={"speed": np.full(samples, speed), "gear": np.arange(samples) // 50},
    )


def slow_first_half_lap(length: float, slow: float, fast: float) -> LapTrace:
    distance = np.linspace(0.0, length, 401)
    half = length / 2
    time = np.where(distance <= half, distance / slow, half / slow + (distance - half) / fast)
    return LapTrace(distance=distance, time=time, channels={"speed": np.zeros(401)})


def test_grid_ends_exactly_at_lap_length() -> None:
    grid = make_grid(1003.0, 5.0)
    assert grid[0] == 0.0
    assert grid[-1] == 1003.0
    assert np.all(np.diff(grid) > 0)


def test_delta_builds_up_where_the_lap_is_slower() -> None:
    reference = constant_speed_lap(1000.0, 100.0)
    other = slow_first_half_lap(1000.0, slow=50.0, fast=100.0)
    result = compare([reference, other], step=10.0)

    delta = result.deltas[1]
    halfway = np.searchsorted(result.distance, 500.0)
    assert delta[halfway] == pytest.approx(5.0)
    assert delta[-1] == pytest.approx(5.0)
    assert np.all(result.deltas[0] == 0)


def test_end_delta_equals_lap_time_difference_despite_different_line_length() -> None:
    reference = constant_speed_lap(5000.0, 80.0)
    longer_line = constant_speed_lap(5020.0, 80.0)
    result = compare([reference, longer_line])
    expected = longer_line.time[-1] - reference.time[-1]
    assert result.deltas[1][-1] == pytest.approx(expected)
    assert result.distance[-1] == pytest.approx(5000.0)


def test_step_channels_are_not_interpolated() -> None:
    trace = constant_speed_lap(1000.0, 100.0)
    resampled = resample(trace, make_grid(1000.0, 3.0), 1000.0)
    assert set(np.unique(resampled.channels["gear"])) <= set(np.unique(trace.channels["gear"]))


def test_duplicate_distances_are_tolerated() -> None:
    trace = LapTrace(
        distance=np.array([0.0, 10.0, 10.0, 20.0]),
        time=np.array([0.0, 1.0, 1.0, 2.0]),
        channels={},
    )
    resampled = resample(trace, np.array([0.0, 15.0, 20.0]), 20.0)
    assert resampled.time.tolist() == pytest.approx([0.0, 1.5, 2.0])


def test_mini_sectors_sum_to_lap_time_and_pick_fastest() -> None:
    reference = constant_speed_lap(1000.0, 100.0)
    other = slow_first_half_lap(1000.0, slow=50.0, fast=200.0)
    result = compare([reference, other], step=5.0)
    sectors = mini_sectors(result, 4)

    assert sectors.times.sum(axis=1) == pytest.approx([10.0, 12.5])
    assert sectors.fastest.tolist() == [0, 0, 1, 1]
    assert sectors.boundaries.tolist() == [0.0, 250.0, 500.0, 750.0, 1000.0]


def test_compare_needs_a_lap() -> None:
    with pytest.raises(ValueError):
        compare([])


def test_outline_distance_follows_the_corners() -> None:
    # A 400 x 200 rectangle in decimetres (120 m round), starting at the bottom-left corner,
    # driven anticlockwise. The lap starts 10 m before the bottom-right corner.
    side = np.linspace(0.0, 1.0, 41)[:-1]
    x = np.concatenate([side * 400, np.full(40, 400.0), 400 - side * 400, np.zeros(40)])
    y = np.concatenate([np.zeros(40), side * 200, np.full(40, 200.0), 200 - side * 200])
    corners = [(10.0, 400.0, 0.0), (30.0, 400.0, 200.0), (70.0, 0.0, 200.0), (90.0, 0.0, 0.0)]

    distance, lap_length = analysis.outline_distance(x, y, corners)

    assert lap_length == pytest.approx(120.0)
    assert distance[0] == pytest.approx(90.0)  # the bottom-left corner
    assert distance[40] == pytest.approx(10.0)  # the bottom-right corner
    assert distance[30] == pytest.approx(0.0, abs=1e-9)  # the line, 10 m before it
    assert distance[60] == pytest.approx(20.0)


def test_outline_distance_without_corners_counts_decimetres() -> None:
    x = np.array([0.0, 100.0, 100.0, 0.0])
    y = np.array([0.0, 0.0, 100.0, 100.0])
    distance, lap_length = analysis.outline_distance(x, y, [])
    assert lap_length == pytest.approx(40.0)
    assert distance.tolist() == pytest.approx([0.0, 10.0, 20.0, 30.0])
