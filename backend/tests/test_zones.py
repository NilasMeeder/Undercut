import numpy as np

from app.zones import drs_zones

LENGTH = 5800.0


def flap_lap(open_ranges: list[tuple[float, float]], length: float = LENGTH) -> tuple:
    distance = np.arange(0.0, length + 1, 20.0)
    flap = np.zeros(distance.size)
    for a, b in open_ranges:
        flap[(distance >= a) & (distance <= b)] = 1
    return distance, flap


def test_zones_are_where_most_laps_have_the_flap_open() -> None:
    laps = [flap_lap([(20, 780), (3040, 3820)]) for _ in range(4)]
    laps.append(flap_lap([(20, 780)]))  # one lap closed it early: still a zone
    zones = drs_zones(laps, LENGTH)
    assert len(zones) == 2
    assert zones[0][0] < 40 and abs(zones[0][1] - 780) < 25
    assert abs(zones[1][0] - 3040) < 25 and abs(zones[1][1] - 3820) < 25


def test_short_openings_and_too_few_laps_give_no_zone() -> None:
    assert drs_zones([flap_lap([(1000, 1060)]) for _ in range(5)], LENGTH) == []
    assert drs_zones([flap_lap([(20, 780)]) for _ in range(2)], LENGTH) == []


def test_a_zone_across_the_line_starts_before_it() -> None:
    laps = [flap_lap([(0, 600), (5300, LENGTH)]) for _ in range(4)]
    zones = drs_zones(laps, LENGTH)
    assert len(zones) == 1
    start, end = zones[0]
    assert -520 < start < -480 and abs(end - 600) < 25


def test_laps_of_another_length_are_scaled_to_the_lap() -> None:
    # A race takes its zones from qualifying: those laps are a few metres longer or shorter.
    laps = [flap_lap([(3045, 3828)], length=5820.0) for _ in range(4)]
    ((start, end),) = drs_zones(laps, LENGTH)
    assert abs(start - 3045 * LENGTH / 5820) < 25 and abs(end - 3828 * LENGTH / 5820) < 25
