import math
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from app import generations
from app.live import convert, feed, telemetry
from app.live.track import LiveTrack, Outline


def test_parse_update_and_state_lines() -> None:
    utc = datetime(2025, 9, 7, 13, 3, 34, 806000, tzinfo=UTC)
    update = feed.parse_line(feed.update_line("TimingData", {"Lines": {"1": {"InPit": True}}}, utc))
    assert update == feed.Message("TimingData", {"Lines": {"1": {"InPit": True}}}, utc)
    # The state after subscribing: a JSON string and no time (FastF1's own reader drops these).
    state = feed.parse_line(feed.state_line("DriverList", {"1": {"Tla": "VER"}}))
    assert state == feed.Message("DriverList", {"1": {"Tla": "VER"}}, None)
    # Quotes inside strings (race control) break FastF1's quote swap, not literal_eval.
    text = str(["RaceControlMessages", {"Messages": [{"Message": "DRIVER'S CAR"}]}, "x"])
    assert feed.parse_line(text).data["Messages"][0]["Message"] == "DRIVER'S CAR"
    assert feed.parse_line("['TimingData', {'Lines'") is None  # cut off mid-write
    assert feed.parse_line("Connection established") is None


def test_parse_utc_fraction_digits() -> None:
    assert feed.parse_utc("2025-09-07T13:03:34Z") == datetime(2025, 9, 7, 13, 3, 34, tzinfo=UTC)
    seven = feed.parse_utc("2025-09-07T13:03:34.8061234Z")
    assert seven == datetime(2025, 9, 7, 13, 3, 34, 806123, tzinfo=UTC)
    assert feed.parse_utc("garbage") is None


def test_deflate_round_trip() -> None:
    value = {"Position": [{"Timestamp": "t", "Entries": {"1": {"X": 1, "Y": -2, "Z": 3}}}]}
    assert feed.inflate(feed.deflate(value)) == value


def test_tail_reads_complete_lines_and_notices_a_restart(tmp_path: Path) -> None:
    path = tmp_path / "live.txt"
    tail = feed.Tail(path)
    assert tail.read() == []  # not there yet
    utc = datetime(2025, 1, 1, tzinfo=UTC)
    line = feed.update_line("Heartbeat", {}, utc)
    path.write_text(line + "\n" + line[:10])
    assert len(tail.read()) == 1
    with path.open("a") as f:
        f.write(line[10:] + "\n")
    assert len(tail.read()) == 1 and not tail.restarted
    path.write_text(line + "\n")  # started over: shorter than what was read
    assert len(tail.read()) == 1 and tail.restarted


def test_state_messages_take_the_time_before_them() -> None:
    origin = datetime(2025, 1, 1, 13, tzinfo=UTC)
    at = lambda s: origin.replace(second=s)  # noqa: E731
    messages = [
        feed.Message("DriverList", {"1": {"Tla": "VER"}}, None),
        feed.Message("Heartbeat", {}, at(10)),
        feed.Message("TimingData", {"Lines": {}}, at(20)),
        feed.Message("TimingData", {"Lines": {}}, None),  # resent after a reconnect
        feed.Message("Position.z", "...", at(30)),
    ]
    data = convert.live_timing_data(messages, origin, skip=convert.TELEMETRY_TOPICS).data
    assert [t.total_seconds() for t, _ in data["TimingData"]] == [20, 20]
    assert data["DriverList"][0][0].total_seconds() == 10
    assert "Position.z" not in data


def test_session_cache_keys_on_the_generation() -> None:
    calls = []

    @generations.session_cache(maxsize=4)
    def laps(year: int, round_number: int, code: str) -> int:
        calls.append(code)
        return len(calls)

    key = (1999, 1, "R")
    assert laps(*key) == laps(*key) == 1
    generations.bump(key)
    assert laps(*key) == 2
    assert laps(1999, 1, "Q") == 3  # other sessions are cached apart


def square_outline() -> Outline:
    # A 400 m square lap (positions in decimetres), the line at (0, 0), driven anticlockwise.
    x = np.array([0.0, 1000, 1000, 0])
    y = np.array([0.0, 0, 1000, 1000])
    return Outline(x=x, y=y, distance=np.array([0.0, 100, 200, 300]), length=400.0)


def test_outline_fraction() -> None:
    outline = square_outline()
    fraction = outline.fraction(np.array([500.0, 1000, 10, 5, -5]), np.array([0, 500, 1000, -3, 3]))
    # The last two are either side of the line.
    assert np.allclose(fraction, [0.125, 0.375, 0.7475, 0.00125, 0.99925], atol=0.001)


def test_live_track_progress_and_the_line() -> None:
    track = LiveTrack(step=1.0)
    # One car round the square in 40 s, 10 m/s, from just before the line.
    for t in range(0, 45):
        d = (t * 10 - 20) % 400  # starts 20 m before the line
        side, along = divmod(d, 100)
        x, y = [(along, 0), (100, along), (100 - along, 100), (0, 100 - along)][int(side)]
        track.add_position(float(t), "1", x * 10, y * 10, 0.0, True)
    track.add_lap_count(2.0, "1", 1)  # crossed the line at t=2
    track.add_lap_count(42.0, "1", 2)
    track.extend(square_outline())
    progress = np.array(track.cars["1"].grid_p)
    assert track.count == 44 - 0  # up to LAG (1 s) before the newest sample
    # Before the first passage it counts back from the line, as in the replay's track.
    assert math.isclose(progress[0], -0.05, abs_tol=0.01)
    assert math.isclose(progress[2], 1.0, abs_tol=0.01)
    assert math.isclose(progress[22], 1.5, abs_tol=0.01)
    assert np.all(np.diff(progress) > 0)  # never a jump back at the line


def test_live_track_snapshot_pads_cars_that_came_later() -> None:
    track = LiveTrack(step=1.0)
    for t in range(6):
        track.add_position(float(t), "1", 0.0, 0.0, 0.0, True)
    track.extend(None)
    for t in range(6, 10):
        track.add_position(float(t), "1", 0.0, 0.0, 0.0, True)
        track.add_position(float(t), "4", 5.0, 5.0, 0.0, True)
    track.extend(None)
    cars = track.snapshot({"1": "VER", "4": "NOR"})
    assert [c["driver"] for c in cars] == ["NOR", "VER"]
    assert len(cars[0]["x"]) == len(cars[1]["x"]) == track.count
    assert cars[0]["x"][0] is None and cars[0]["x"][-1] == 5


def test_lap_telemetry_integrates_distance_and_holds_gears() -> None:
    car, pos = telemetry.Samples(), telemetry.Samples()
    for i in range(0, 41):
        t = i * 0.25
        channels = {"0": 11000, "2": 180, "3": 7 if t < 5 else 8, "4": 100, "5": 0, "45": 12}
        car.add(t, telemetry.car_sample(channels))
        pos.add(t + 0.1, {"x": t * 500, "y": 0.0, "z": 0.0})
    tel = telemetry.lap_telemetry(car, pos, 1.0, 9.0)
    assert tel is not None
    assert tel["time"][0] == 0 and tel["time"][-1] == 8
    assert math.isclose(tel["distance"][-1], 8 * 50, rel_tol=1e-6)  # 180 km/h = 50 m/s
    assert set(tel["gear"]) == {7, 8} and set(tel["drs"]) == {1}
    assert telemetry.lap_telemetry(car, pos, 5.0, 20.0) is None  # samples end before the lap


def test_samples_copy_is_cut_to_whole_samples() -> None:
    samples = telemetry.Samples()
    samples.add(1.0, {"speed": 100.0})
    samples.add(2.0, {"speed": 110.0})
    samples.t.append(3.0)  # a sample half added: its value is not in yet
    copy = samples.copy()
    assert (list(copy.t), list(copy.values["speed"])) == ([1.0, 2.0], [100.0, 110.0])
    samples.add(4.0, {"speed": 0.0})  # the original still grows (no buffer is exported)
    assert copy.last == 2.0
