import numpy as np

from app import starts
from app.analysis import LapTrace
from app.live.track import Outline
from tests.test_replay import make_lap

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
