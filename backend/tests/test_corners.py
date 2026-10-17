import numpy as np

from app.analysis import LapTrace, compare, corner_segments

TOP = 300.0  # km/h


def cornering_lap(
    length: float,
    corners: list[tuple[float, float]],
    braking: float = 1.0,
    traction: float = 0.6,
) -> LapTrace:
    """
    Speed dips to `min_speed` at each (apex, min_speed). `braking` and `traction` are km/h per
    metre before and after the apex: a harder braker reaches the corner later.
    """
    distance = np.linspace(0.0, length, int(length) + 1)
    speed = np.full(distance.size, TOP)
    brake = np.zeros(distance.size, dtype=int)
    throttle = np.full(distance.size, 100.0)
    for apex, min_speed in corners:
        before = min_speed + braking * (apex - distance)
        after = min_speed + traction * (distance - apex)
        dip = np.where(distance < apex, before, after)
        slower = dip < speed
        speed = np.where(slower, dip, speed)
        brake = np.where(slower & (distance < apex), 1, np.where(slower, 0, brake))
        throttle = np.where(slower & (distance < apex), 0.0, throttle)
    time = np.concatenate(([0.0], np.cumsum(np.diff(distance) / (speed[1:] / 3.6))))
    return LapTrace(
        distance=distance,
        time=time,
        channels={"speed": speed, "brake": brake, "throttle": throttle},
    )


CORNERS = [("1", 1000.0), ("2", 2500.0)]
APEXES = [(1000.0, 100.0), (2500.0, 150.0)]


def test_segments_add_up_to_the_lap_time_difference() -> None:
    a = cornering_lap(4000, APEXES)
    b = cornering_lap(4000, [(1000.0, 95.0), (2500.0, 160.0)])
    comparison = compare([a, b], step=5.0)
    segments = corner_segments(comparison, CORNERS)

    assert [s.label for s in segments] == ["T1", "T2"]
    assert segments[0].start == 0.0 and segments[-1].end == 4000.0
    total = sum(s.laps[1].time - s.laps[0].time for s in segments)
    assert abs(total - float(comparison.deltas[1][-1])) < 1e-6
    # Slower through T1, quicker through T2.
    assert segments[0].laps[1].time > segments[0].laps[0].time
    assert segments[1].laps[1].time < segments[1].laps[0].time


def test_boundary_is_the_top_speed_between_corners() -> None:
    lap = cornering_lap(4000, APEXES)
    segments = corner_segments(compare([lap], step=5.0), CORNERS)
    # Full speed is reached 200 m after T1 (0.6 km/h per m) and held until braking for T2.
    assert 1300.0 <= segments[0].end <= 2350.0


def test_later_braking_is_measured() -> None:
    a = cornering_lap(4000, APEXES, braking=1.0)
    b = cornering_lap(4000, APEXES, braking=2.0)
    stats = corner_segments(compare([a, b], step=5.0), CORNERS)[0].laps
    # 200 km/h to shed: 200 m before the apex at 1 km/h/m, 100 m at 2 km/h/m.
    assert abs(stats[0].brake_at - 800.0) <= 5.0
    assert abs(stats[1].brake_at - 900.0) <= 5.0
    assert stats[0].min_speed == stats[1].min_speed == 100.0
    assert stats[1].time < stats[0].time


def test_chicane_is_one_segment() -> None:
    lap = cornering_lap(4000, [(1000.0, 100.0), (1080.0, 110.0), (2500.0, 150.0)])
    segments = corner_segments(
        compare([lap], step=5.0), [("1", 1000.0), ("2", 1080.0), ("3", 2500.0)]
    )
    assert [s.label for s in segments] == ["T1–2", "T3"]
    assert segments[0].laps[0].brake_at is not None
    assert segments[0].laps[0].throttle_at is not None


def test_no_corners_gives_no_segments() -> None:
    lap = cornering_lap(4000, APEXES)
    assert corner_segments(compare([lap], step=5.0), []) == []
    assert corner_segments(compare([lap], step=5.0), [("9", 9999.0)]) == []
