from datetime import UTC, datetime
from typing import Any

import numpy as np
import pytest

from app import replay, sessions
from app.schemas import Lap, RaceControlMessage, Segment, StatusPeriod
from app.sources import jolpica


def make_lap(driver: str, number: int, **fields: Any) -> Lap:
    base: dict[str, Any] = {name: None for name in Lap.model_fields}
    base.update(
        driver=driver,
        lap=number,
        personal_best=False,
        deleted=False,
        accurate=True,
        pit_in=False,
        pit_out=False,
    )
    return Lap(**(base | fields))


def race_lap(driver: str, number: int, start: float, s1: float, s2: float, s3: float, **kw) -> Lap:
    """A lap with its sector times and the session times of its three timing points."""
    return make_lap(
        driver,
        number,
        start_time=start,
        sector_1=s1,
        sector_2=s2,
        sector_3=s3,
        lap_time=round(s1 + s2 + s3, 3),
        sector_1_end=start + s1,
        sector_2_end=start + s1 + s2,
        end_time=start + s1 + s2 + s3,
        **kw,
    )


# --- Position track ------------------------------------------------------------------------------


def samples(driver: str, lap: int, start: float, duration: float, from_line: bool = True):
    t = np.linspace(0.0, duration, 11)
    d = np.linspace(0.0, 1000.0, 11)
    return replay.LapSamples(driver, lap, start, t, d, d.copy(), np.zeros(11), from_line)


def test_track_interpolates_onto_the_grid() -> None:
    track = replay.build_track([samples("VER", 1, 10.0, 10.0), samples("VER", 2, 20.0, 10.0)], {})
    assert track.start == 10.0
    assert track.lap_length == 1000.0
    i = round((15.0 - track.start) / track.step)
    assert track.x[0, i] == pytest.approx(500.0)
    assert track.progress[0, i] == pytest.approx(0.5)
    # Halfway through lap 2: one lap and a half driven.
    i = round((25.0 - track.start) / track.step)
    assert track.progress[0, i] == pytest.approx(1.5)


def test_track_is_empty_between_runs_and_in_the_garage() -> None:
    laps = [samples("NOR", 1, 0.0, 10.0), samples("NOR", 2, 100.0, 10.0)]
    track = replay.build_track(laps, {"NOR": [(2.0, 4.0)]})
    at = lambda t: track.x[0, round((t - track.start) / track.step)]  # noqa: E731
    assert np.isnan(at(3.0))  # garage window
    assert np.isnan(at(50.0))  # no samples between 10 s and 100 s
    assert not np.isnan(at(5.0))
    assert not np.isnan(at(105.0))


def test_lap_from_the_grid_is_measured_back_from_the_line() -> None:
    """Race lap 1 is shorter than a lap; its first sample is not at the line."""
    lap = samples("VER", 1, 0.0, 10.0, from_line=False)
    lap.distance = np.linspace(0.0, 900.0, 11)
    fraction = replay.lap_fraction(lap, 1000.0)
    assert fraction[0] == pytest.approx(0.1)
    assert fraction[-1] == pytest.approx(0.9999)


def test_garage_windows_only_for_long_stops() -> None:
    laps = [
        make_lap("VER", 1, pit_in_time=100.0),
        make_lap("VER", 2, pit_out_time=125.0),  # 25 s: a pit stop
        make_lap("VER", 3, pit_in_time=200.0),
        make_lap("VER", 4, pit_out_time=600.0),  # garage
    ]
    assert replay.garage_windows(laps) == {"VER": [(200.0, 600.0)]}


# --- Track status --------------------------------------------------------------------------------


def message(
    at: float,
    category: str,
    text: str,
    flag: str | None = None,
    scope: str | None = None,
    sector: int | None = None,
):
    return RaceControlMessage(
        utc=datetime(2025, 1, 1, tzinfo=UTC),
        session_time=at,
        category=category,
        message=text,
        flag=flag,
        scope=scope,
        sector=sector,
        driver=None,
        lap=None,
    )


def test_track_status_periods() -> None:
    messages = [
        message(50.0, "Flag", "GREEN LIGHT - PIT EXIT OPEN", "GREEN", "Track"),
        message(200.0, "SafetyCar", "SAFETY CAR DEPLOYED"),
        message(300.0, "SafetyCar", "SAFETY CAR IN THIS LAP"),
        message(350.0, "Flag", "TRACK CLEAR", "CLEAR", "Track"),
        message(400.0, "Flag", "YELLOW IN TRACK SECTOR 3", "YELLOW", "Sector"),
        message(500.0, "Flag", "RED FLAG", "RED", "Track"),
        message(600.0, "Flag", "TRACK CLEAR", "CLEAR", "Track"),  # still red
        message(700.0, "Flag", "GREEN LIGHT - PIT EXIT OPEN", "GREEN", "Track"),
        message(900.0, "Flag", "CHEQUERED FLAG", "CHEQUERED", "Track"),
    ]
    periods = replay.track_status_periods(messages, 100.0, 1000.0)
    assert [(p.start, p.end, p.status) for p in periods] == [
        (100.0, 200.0, "green"),
        (200.0, 350.0, "sc"),
        (350.0, 500.0, "green"),
        (500.0, 700.0, "red"),
        (700.0, 900.0, "green"),
        (900.0, 1000.0, "chequered"),
    ]
    assert replay.status_at(periods, 250.0) == "sc"


def test_sector_flag_periods() -> None:
    def sector(at: float, flag: str, number: int):
        return message(at, "Flag", f"{flag} IN TRACK SECTOR {number}", flag, "Sector", number)

    messages = [
        sector(50.0, "YELLOW", 7),  # before the range: starts at the range start
        sector(200.0, "YELLOW", 8),
        sector(210.0, "YELLOW", 8),  # repeated: still one period
        sector(250.0, "DOUBLE YELLOW", 8),  # upgraded: a new period
        sector(300.0, "CLEAR", 8),
        sector(320.0, "CLEAR", 9),  # never yellow
        sector(400.0, "YELLOW", 3),
        message(500.0, "Flag", "RED FLAG", "RED", "Track"),  # ends every sector flag
        sector(900.0, "YELLOW", 1),  # still yellow at the end
    ]
    periods = replay.sector_flag_periods(messages, 100.0, 1000.0)
    assert [(p.sector, p.start, p.end, p.flag) for p in periods] == [
        (7, 100.0, 500.0, "yellow"),
        (8, 200.0, 250.0, "yellow"),
        (8, 250.0, 300.0, "double_yellow"),
        (3, 400.0, 500.0, "yellow"),
        (1, 900.0, 1000.0, "yellow"),
    ]


def test_marshal_sectors_run_to_the_next_one() -> None:
    sectors = sessions.marshal_sectors([1, 2, 3], [5704.0, 452.0, 749.0])
    assert [(s.number, s.start, s.end) for s in sectors] == [
        (2, 452.0, 749.0),
        (3, 749.0, 5704.0),
        (1, 5704.0, 452.0),  # over the line
    ]


# --- Timing tower: race --------------------------------------------------------------------------


@pytest.fixture
def race() -> replay.TimingIndex:
    """Three laps. VER leads; NOR is 2 s behind and pits after lap 1; ALO retires after lap 1;
    SAR is so slow he is lapped by the end."""
    laps = [
        race_lap("VER", 1, 0.0, 30.0, 30.0, 30.0),
        race_lap("VER", 2, 90.0, 30.0, 30.0, 30.0),
        race_lap("VER", 3, 180.0, 30.0, 30.0, 29.0),
        race_lap("NOR", 1, 0.0, 31.0, 30.5, 30.5, pit_in=True, pit_in_time=88.0),
        race_lap("NOR", 2, 92.0, 50.0, 30.0, 30.0, pit_out=True, pit_out_time=110.0),
        race_lap("NOR", 3, 202.0, 30.0, 30.0, 30.0),
        race_lap("ALO", 1, 0.0, 32.0, 31.0, 31.0),
        race_lap("SAR", 1, 0.0, 45.0, 45.0, 45.0),
        race_lap("SAR", 2, 135.0, 45.0, 45.0, 45.0),
    ]
    return replay.build_index(laps, "race", [])


def rows(index: replay.TimingIndex, t: float) -> dict[str, Any]:
    return {r.driver: r for r in replay.timing_state(index, t).rows}


def test_race_order_before_the_first_timing_point_is_the_grid() -> None:
    laps = [
        race_lap("VER", 1, 0.0, 30.0, 30.0, 30.0),
        race_lap("NOR", 1, 0.0, 30.5, 30.0, 30.0),
        race_lap("PIA", 1, 0.0, 31.0, 30.0, 30.0),
    ]
    by_passage = replay.build_index(laps, "race", [])
    assert [r.driver for r in replay.timing_state(by_passage, 5.0).rows] == ["VER", "NOR", "PIA"]
    grid = {"PIA": 1, "NOR": 2, "VER": jolpica.PIT_LANE_START}
    on_grid = replay.build_index(laps, "race", [], grid)
    assert [r.driver for r in replay.timing_state(on_grid, 5.0).rows] == ["PIA", "NOR", "VER"]
    # After the first sector line the order is on track again.
    assert [r.driver for r in replay.timing_state(on_grid, 31.5).rows] == ["VER", "NOR", "PIA"]


def test_parse_grid() -> None:
    def result(code: str, grid: str) -> dict:
        return {"Driver": {"code": code}, "grid": grid}

    results = [result("VER", "1"), result("HUL", "0")]
    data = {"MRData": {"RaceTable": {"Races": [{"Results": results}]}}}
    assert jolpica.parse_grid(data, sprint=False) == {"VER": 1, "HUL": jolpica.PIT_LANE_START}
    assert jolpica.parse_grid(data, sprint=True) == {}
    assert jolpica.parse_grid({"MRData": {"RaceTable": {"Races": []}}}, sprint=False) == {}


def test_race_order_and_gaps_at_the_line(race: replay.TimingIndex) -> None:
    state = replay.timing_state(race, 93.0)
    assert [r.driver for r in state.rows] == ["VER", "NOR", "ALO", "SAR"]
    nor = state.rows[1]
    assert nor.gap == pytest.approx(2.0)  # crossed the line at 92 against VER's 90
    assert nor.interval == pytest.approx(2.0)
    assert state.lap == 2
    assert state.total_laps == 3


def test_race_gaps_update_at_sector_lines(race: replay.TimingIndex) -> None:
    # 125 s: VER passed S1 of lap 2 at 120; NOR (out-lap) is still before it.
    assert rows(race, 125.0)["VER"].sectors[0].time == 30.0
    assert rows(race, 125.0)["VER"].sectors[0].current
    assert rows(race, 125.0)["NOR"].gap == pytest.approx(2.0)
    assert rows(race, 145.0)["NOR"].gap == pytest.approx(22.0)  # S1 at 142 vs 120


def test_race_pit_retired_and_lapped(race: replay.TimingIndex) -> None:
    assert rows(race, 100.0)["NOR"].status == "pit"
    assert rows(race, 115.0)["NOR"].status == "running"
    assert rows(race, 115.0)["NOR"].pit_stops == 1
    late = rows(race, 270.0)
    assert late["ALO"].status == "retired"
    assert late["ALO"].gap is None
    assert late["VER"].status == "finished"
    # SAR finished lap 2 at 270; VER had passed that line a lap later at 269.
    assert late["SAR"].laps_down == 1
    assert late["SAR"].gap is None
    assert replay.timing_state(race, 270.0).rows[-1].driver == "ALO"


def test_race_valid_window_brackets_t(race: replay.TimingIndex) -> None:
    state = replay.timing_state(race, 100.0)
    assert state.valid_from == 94.0  # ALO crosses the line
    assert state.valid_until == 110.0  # NOR leaves the pit
    # Nothing changes in between, so the client need not ask again.
    assert replay.timing_state(race, 109.9).rows == state.rows


def test_no_negative_interval_after_a_pit_stop() -> None:
    """HAM was ahead at the line (90 vs 91) but is slow in the pit lane: RUS passes S1 first."""
    laps = [
        race_lap("RUS", 1, 0.0, 30.0, 30.0, 31.0),
        race_lap("RUS", 2, 91.0, 30.0, 30.0, 30.0),
        race_lap("HAM", 1, 0.0, 30.0, 30.0, 30.0, pit_in=True, pit_in_time=88.0),
        race_lap("HAM", 2, 90.0, 55.0, 30.0, 30.0, pit_out=True, pit_out_time=112.0),
    ]
    state = replay.timing_state(replay.build_index(laps, "race", []), 130.0)
    assert [r.driver for r in state.rows] == ["RUS", "HAM"]
    assert state.rows[1].interval is None
    assert state.rows[1].gap is None


def test_sector_colours_are_as_they_were_when_set(race: replay.TimingIndex) -> None:
    # VER's 30.0 in S1 of lap 1 was the fastest at the time.
    assert rows(race, 31.0)["VER"].sectors[0].timing == "best"
    assert rows(race, 31.0)["NOR"].sectors[0].timing == "pb"


# --- Timing tower: qualifying --------------------------------------------------------------------


def quali_lap(driver: str, number: int, segment: str, start: float, time: float | None) -> Lap:
    return make_lap(
        driver,
        number,
        quali_segment=segment,
        start_time=start,
        end_time=start + (time or 100.0),
        lap_time=time,
    )


@pytest.fixture
def quali() -> replay.TimingIndex:
    laps = [
        quali_lap("VER", 1, "Q1", 0.0, 80.0),
        quali_lap("NOR", 1, "Q1", 0.0, 80.5),
        quali_lap("HAD", 1, "Q1", 0.0, 81.0),
        quali_lap("VER", 2, "Q2", 1000.0, 79.5),
        quali_lap("NOR", 2, "Q2", 1000.0, 79.0),
    ]
    return replay.build_index(laps, "quali", [])


def test_quali_orders_by_best_lap_with_gaps(quali: replay.TimingIndex) -> None:
    state = replay.timing_state(quali, 500.0)
    assert state.segment == "Q1"
    assert state.cutoff == 2
    assert [r.driver for r in state.rows] == ["VER", "NOR", "HAD"]
    assert state.rows[1].gap == pytest.approx(0.5)
    assert state.rows[2].interval == pytest.approx(0.5)


def test_quali_eliminated_drivers_below(quali: replay.TimingIndex) -> None:
    state = replay.timing_state(quali, 1500.0)
    assert state.segment == "Q2"
    assert [(r.driver, r.eliminated) for r in state.rows] == [
        ("NOR", False),
        ("VER", False),
        ("HAD", True),
    ]
    assert state.rows[0].best_lap == 79.0
    assert state.rows[2].best_lap == 81.0
    assert state.rows[2].status == "garage"


def test_session_clock_counts_down_each_part_and_stops_for_red_flags() -> None:
    parts = [
        Segment(name="Q1", start=100.0, end=1300.0),
        Segment(name="Q2", start=1800.0, end=2800),
    ]
    red = [StatusPeriod(start=400.0, end=1000.0, status="red")]
    points = replay.session_clock("quali", 90.0, parts, red)
    assert [(p.t, p.remaining, p.running) for p in points] == [
        (100.0, 1080.0, True),
        (400.0, 780.0, False),  # 300 s gone when the red flag came out
        (1000.0, 780.0, True),
        (1800.0, 900.0, True),  # Q2: 15 minutes, the red flag was before it
    ]
    assert [p.remaining for p in replay.session_clock("practice", 50.0, [], [])] == [3600.0]
    assert replay.session_clock("race", 0.0, [], red) == []
