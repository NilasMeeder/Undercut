from app.schemas import TrackZone
from app.sources.fia import activation, parse
from app.straight_mode import low_grip_periods, place, zone_end

# The zone table as pypdf reads it off the FIA's circuit maps (2026).
MONZA = """CIRCUIT CENTRELINE LENGTH -  5.793km
Circuit Map
OVERTAKE STRAIGHT MODE
-   ZONE A1   -
-   ZONE A2   -
-   ZONE A3   -
-   ZONE A4   -
ACTIVATION
DETECTION 30m after T11 / Pit Exit
70m after T3
170m after T7
130m after T10
100m after T11 / Pit Exit
110m after T3
230m after T7
180m after T10
-  T11
-  Entry T11
15
LEGEND
"""
# The sector data comes just before the table on this one.
BAKU = """ SPEED TRAP  [T]
-  210m after T20
-  55m before T16
-  45m before T5 INTERMEDIATE 1  [S1]
CIRCUIT CENTRELINE LENGTH -  6.003km
Circuit Map
-   ZONE A1   -
-   ZONE A2   -ACTIVATION
DETECTION 45m after T19
110m after T2
45m after T20
160m after T2-  20m before T17
-  90m after T16
15
LEGEND
CIRCUIT DATA OVERTAKE STRAIGHT MODE
"""
JAPAN = """STRAIGHT MODE
-   ZONE A1   -
-   ZONE A2   -
-   ZONE A3   -
ACTIVATION
DETECTION Exit T18
Exit T14
n/a
100m after T18
70m after T14
n/a
-  Apex T18
-  Exit T17
15
LEGEND
"""


def test_the_table_is_read_per_zone_with_normal_and_low_grip() -> None:
    found = parse(MONZA)
    assert [z.label for z in found.zones] == ["A1", "A2", "A3", "A4"]
    a1 = found.zones[0]
    assert (a1.normal.corner, a1.normal.metres) == ("11", 30.0)
    assert a1.normal.text == "30m after T11 / Pit Exit"
    assert a1.low_grip is not None and a1.low_grip.metres == 100.0
    assert found.overtake == ["T11", "Entry T11"]


def test_the_sector_data_before_the_table_is_not_a_zone() -> None:
    found = parse(BAKU)
    assert [(z.normal.corner, z.normal.metres) for z in found.zones] == [("19", 45), ("2", 110)]
    assert found.zones[0].low_grip is not None and found.zones[0].low_grip.corner == "20"
    assert found.overtake == ["20m before T17", "90m after T16"]


def test_a_zone_not_in_use_is_left_out_and_exits_are_at_the_corner() -> None:
    found = parse(JAPAN)
    assert [(z.label, z.normal.corner, z.normal.metres) for z in found.zones] == [
        ("A1", "18", 0.0),
        ("A2", "14", 0.0),
    ]


def test_points_before_a_corner_and_corners_with_a_letter() -> None:
    before = activation("40m before T3 exit")
    assert before is not None and (before.corner, before.metres) == ("3", -40.0)
    lettered = activation("30m after T1A-entry")
    assert lettered is not None and lettered.corner == "1A"
    assert activation("n/a") is None


def test_a_map_without_zones() -> None:
    assert parse("OVERTAKE STRAIGHT MODE\nACTIVATION\nLEGEND").zones == []


LENGTH = 5800.0
CORNERS = {"1": 800.0, "3": 1400.0, "11": 5200.0}
STRAIGHTS = [
    TrackZone(label="T11 → T1", start=-590.0, end=750.0),
    TrackZone(label="T3 → T4", start=1650.0, end=1980.0),
]


def test_a_point_after_the_last_corner_wraps_round() -> None:
    assert place(CORNERS, LENGTH, {"corner": "11", "metres": 30.0}) == 5230.0
    assert place(CORNERS, LENGTH, {"corner": "11", "metres": 700.0}) == 100.0
    assert place(CORNERS, LENGTH, {"corner": "12", "metres": 30.0}) is None


def test_a_zone_ends_where_its_straight_brakes() -> None:
    # On the exit of T11, before the straight is at full throttle: before the line, below zero.
    assert zone_end(5230.0, STRAIGHTS, list(CORNERS.values()), LENGTH) == (-570.0, 750.0, "braking")
    # The activation point in the exit of Curva Grande, before the straight starts.
    assert zone_end(1470.0, STRAIGHTS, list(CORNERS.values()), LENGTH)[1:] == (1980.0, "braking")


def test_a_zone_ends_where_the_next_starts_or_where_it_is_drawn() -> None:
    corners = list(CORNERS.values())
    assert zone_end(-500.0 + LENGTH, STRAIGHTS, corners, LENGTH, next_start=300.0)[1:] == (
        300.0,
        "next_zone",
    )
    assert zone_end(5230.0, STRAIGHTS, corners, LENGTH, drawn=200.0)[1:] == (200.0, "drawing")


def test_without_a_straight_the_zone_ends_before_the_next_corner() -> None:
    assert zone_end(3000.0, [], list(CORNERS.values()), LENGTH) == (3000.0, 5050.0, "next_corner")


def test_low_grip_lasts_until_race_control_says_normal_grip() -> None:
    periods = low_grip_periods(
        [
            (100.0, "LOW GRIP DELTA ACTIVE"),
            (101.0, "LOW GRIP CONDITIONS"),
            (900.0, "NORMAL GRIP CONDITIONS"),
            (1200.0, "LOW GRIP CONDITIONS"),
        ]
    )
    assert [(p.start, p.end) for p in periods] == [(101.0, 900.0), (1200.0, None)]
