from app.schemas import TrackZone
from app.sources.fia import activation, keep_by_hand, parse
from app.straight_mode import low_grip_periods, overtake_periods, place, place_edge, zone_end

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
    assert found.overtake is not None
    assert found.overtake.detection.text == "Entry T11"
    assert found.overtake.activation.text == "T11"


def test_the_sector_data_before_the_table_is_not_a_zone() -> None:
    found = parse(BAKU)
    assert [(z.normal.corner, z.normal.metres) for z in found.zones] == [("19", 45), ("2", 110)]
    assert found.zones[0].low_grip is not None and found.zones[0].low_grip.corner == "20"
    assert found.overtake is not None
    assert (found.overtake.detection.corner, found.overtake.detection.metres) == ("16", 90.0)
    assert (found.overtake.activation.corner, found.overtake.activation.metres) == ("17", -20.0)


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


# Monaco: no straight-mode zones, but overtake mode; the sector data comes first.
MONACO = """ SPEED TRAP  [T]
 INTERMEDIATE 2  [S2]
-  190m before T10
-  70m before T13
-  60m before T5 INTERMEDIATE 1  [S1]
CIRCUIT CENTRELINE LENGTH -  3.337km
Circuit Map
OVERTAKE STRAIGHT MODE
N/A
ACTIVATION
DETECTION
-  40m after T18
-  80m after T16
15
LEGEND
"""
# Australia: the sector data comes after the overtake points.
AUSTRALIA = """-   ZONE A1   -
-   ZONE A2   -
CIRCUIT DATA
ACTIVATION
DETECTION 50m after T14
20m after T2
100m after T14
n/a
-  Entry T14
-  15m after T13
SECTOR 3
-  2.112km
 SPEED TRAP  [T]
-  120m before T1
-  140m before T9
LEGEND
STRAIGHT MODE
"""


def test_overtake_points_without_zones() -> None:
    found = parse(MONACO)
    assert found.zones == []
    assert found.overtake is not None
    assert found.overtake.detection.text == "80m after T16"
    assert found.overtake.activation.text == "40m after T18"


def test_the_speed_trap_after_the_table_is_not_an_overtake_point() -> None:
    found = parse(AUSTRALIA)
    assert [z.label for z in found.zones] == ["A1", "A2"]
    assert found.overtake is not None
    assert found.overtake.detection.text == "15m after T13"
    assert found.overtake.activation.text == "Entry T14"


def test_points_entered_by_hand_survive_a_new_read() -> None:
    old = {
        "zones": [{"label": "A2", "end": {"corner": "2", "metres": -80.0, "text": "x"}}],
        "overtake": {"detection": {"corner": "3"}, "activation": {"corner": "4"}},
        "note": "by hand",
    }
    new = keep_by_hand({"zones": [{"label": "A1"}, {"label": "A2"}], "overtake": None}, old)
    assert new["zones"][1]["end"]["metres"] == -80.0
    assert "end" not in new["zones"][0]
    assert new["overtake"] == old["overtake"]
    assert new["note"] == "by hand"


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


def test_overtake_mode_is_enabled_until_race_control_disables_it() -> None:
    periods = overtake_periods(
        [
            (100.0, "OVERTAKE DISABLED"),
            (400.0, "OVERTAKE ENABLED"),
            (900.0, "OVERTAKE DISABLED"),
            (1500.0, "OVERTAKE ENABLED"),
            (1600.0, "OVERTAKE ENABLED"),
        ]
    )
    assert [(p.start, p.end) for p in periods] == [(400.0, 900.0), (1500.0, None)]


def test_an_overtake_point_at_the_entry_is_before_the_corner() -> None:
    def point(text: str) -> dict:
        found = activation(text)
        assert found is not None
        return {"corner": found.corner, "metres": found.metres, "text": found.text}

    assert place_edge(CORNERS, LENGTH, point("Entry T11")) == 5150.0
    assert place_edge(CORNERS, LENGTH, point("T11")) == 5200.0
    assert place_edge(CORNERS, LENGTH, point("45m before T3 Exit")) == 1405.0
