import numpy as np

from app import starts
from app.analysis import LapTrace
from app.live.track import Outline
from tests.test_replay import make_lap, message

SIDE = 1000.0  # metres; the outline is a square, the line at its first corner


def square() -> Outline:
    corners = np.array([[0, 0], [SIDE, 0], [SIDE, SIDE], [0, SIDE]]) * 10  # decimetres
    points = np.concatenate(
        [np.linspace(corners[i], corners[(i + 1) % 4], 50, endpoint=False) for i in range(4)]
    )
    distance = np.arange(len(points)) * (4 * SIDE / len(points))
    return Outline(x=points[:, 0], y=points[:, 1], distance=distance, length=4 * SIDE)


def launch(slot: float, move: float, accel: float, vmax: float = 300.0) -> LapTrace:
    """A car standing `slot` m past the line until `move` s, then accelerating at `accel` m/s²
    up to vmax km/h, along the first side of the square."""
    t = np.arange(0, 40, 0.25)
    run = np.clip(t - move, 0, None)
    v = np.minimum(accel * run, vmax / 3.6)
    d = np.concatenate([[0], np.cumsum((v[1:] + v[:-1]) / 2 * np.diff(t))])
    return LapTrace(
        distance=d,
        time=t,
        channels={"speed": v * 3.6, "x": (slot + d) * 10, "y": np.zeros_like(t)},
    )


def test_slots_order_and_launch():
    outline = square()
    traces = {
        "VER": launch(300.0, 0.5, 9.0),
        "NOR": launch(292.0, 0.5, 9.4),  # 8 m back, quicker off the line
        "PIA": launch(284.0, 0.5, 8.0),
        "GAS": launch(100.0, 9.0, 9.0),  # pit lane: moves off well after the field
        "ALB": LapTrace(  # positions but no car data
            distance=np.zeros(5),
            time=np.arange(5.0),
            channels={"speed": np.zeros(5), "x": np.full(5, 2800.0), "y": np.zeros(5)},
        ),
    }
    slots = {d: starts.grid_slot(tr, outline) for d, tr in traces.items()}
    assert abs(slots["NOR"] - 292.0) < 1 and slots["ALB"] is None
    grid = {"VER": 1, "NOR": 2, "PIA": 3, "ALB": 4, "GAS": 5}
    laps = {d: make_lap(d, 1, position=grid[d], end_time=100.0) for d in grid}
    result = starts.analyse(traces, slots, grid, laps, lights_out=50.0)
    cars = {c.driver: c for c in result.cars}
    assert abs(cars["NOR"].slot - 8.0) < 1 and cars["VER"].slot == 0.0
    # NOR gets past VER before 500 m past the pole slot.
    assert [c.driver for c in result.cars][:3] == ["NOR", "VER", "PIA"]
    assert cars["NOR"].positions[0] == 2 and cars["NOR"].positions[-1] == 1
    # At 9 m/s² 100 km/h comes 27.8/9 = 3.1 s after moving off.
    assert abs(cars["VER"].to_100 - (0.5 + 100 / 3.6 / 9.0)) < 0.05
    assert cars["GAS"].pit_lane and cars["GAS"].times == [None] * 5
    assert not cars["ALB"].moved and cars["ALB"].positions[-1] is None


def test_bad_slot_falls_back_to_its_place():
    traces = {d: launch(300.0 - 8.0 * i, 0.5, 9.0) for i, d in enumerate(("VER", "NOR", "PIA"))}
    slots = {"VER": 300.0, "NOR": 292.0, "PIA": 299.0}  # PIA's x/y say pole: wrong
    grid = {"VER": 1, "NOR": 2, "PIA": 3}
    laps = {d: make_lap(d, 1, position=grid[d], end_time=100.0) for d in grid}
    cars = {c.driver: c for c in starts.analyse(traces, slots, grid, laps, 0.0).cars}
    assert cars["PIA"].slot == 16.0 and cars["NOR"].slot == 8.0


def standing(slot: float, still_from: float, move: float, accel: float = 9.0) -> LapTrace:
    """Driving at 50 m/s, standing on the grid from `still_from` s, off again at `move`."""
    t = np.arange(0, 120, 0.25)
    v = np.where(t < still_from - 5, 50.0, np.clip((still_from - t) * 10, 0, 50))
    v = np.where(t >= move, np.minimum(accel * (t - move), 80.0), v)
    d = np.concatenate([[0], np.cumsum((v[1:] + v[:-1]) / 2 * np.diff(t))])
    d = d - np.interp(move, t, d) + slot  # metres past the line where it stands
    return LapTrace(distance=d - d[0], time=t, channels={"speed": v * 3.6, "x": d * 10, "y": 0 * t})


def test_restart_found_where_the_field_moves_off_together():
    traces = {
        "RUS": standing(300.0, 40.0, 80.3),
        "VER": standing(284.0, 42.0, 80.5),
        "ANT": standing(212.0, 50.0, 80.4),
        "GAS": standing(100.0, 30.0, 95.0),  # pit lane: off when the field has passed
    }
    moves = {d: starts.move_offs(tr) for d, tr in traces.items()}
    assert abs(moves["RUS"][0] - 80.5) < 0.01  # the first sample moving
    lights_out = starts.standing_start(moves)
    assert lights_out is not None and abs(lights_out - 80.5) < 0.3
    after = {d: starts.from_lights_out(tr, lights_out - 0.4) for d, tr in traces.items()}
    assert after["RUS"].distance[0] == 0.0 and after["RUS"].time[0] < 0
    assert after["RUS"].channels["speed"][0] < 1
    slots = {d: starts.grid_slot(tr, square()) for d, tr in after.items()}
    laps = {d: make_lap(d, 6, position=i + 1, end_time=200.0) for i, d in enumerate(traces)}
    result = starts.analyse(after, slots, None, laps, lights_out - 0.4, lap=6, order={"GAS": 4})
    cars = {c.driver: c for c in result.cars}
    assert result.restart and result.lap == 6
    assert [cars[d].grid for d in ("RUS", "VER", "ANT")] == [1, 2, 3]
    assert abs(cars["VER"].slot - 16.0) < 1 and cars["GAS"].pit_lane


def test_staggered_pit_exits_are_no_start():
    moves = {f"C{i}": [10.0 + 2.5 * i] for i in range(10)}
    assert starts.standing_start(moves) is None


def test_joined_laps_run_on():
    a = LapTrace(
        distance=np.array([0.0, 50.0, 100.0]),
        time=np.array([0.0, 1.0, 2.0]),
        channels={"speed": np.array([1.0, 2.0, 3.0])},
    )
    b = LapTrace(
        distance=np.array([0.0, 50.0]),
        time=np.array([0.0, 1.0]),
        channels={"speed": np.array([4.0, 5.0])},
    )
    trace = starts.joined([(10.0, a), (12.0, b)])
    assert trace.distance.tolist() == [0, 50, 100, 100, 150]
    assert trace.time.tolist() == [10, 11, 12, 12, 13]


def test_only_standing_restarts_after_a_red_flag():
    messages = [
        message(100.0, "Other", "STANDING START"),  # the race start
        message(900.0, "Other", "RED FLAG - RACE SUSPENDED"),
        message(1500.0, "Other", "STANDING START"),
        message(1700.0, "Other", "STANDING START"),  # after an aborted start
        message(3000.0, "Flag", "RED FLAG", flag="RED"),
        message(3600.0, "Other", "ROLLING START PROCEDURE"),
    ]
    assert starts.suspensions(messages) == [(900.0, 1700.0)]
