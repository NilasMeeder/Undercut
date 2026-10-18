"""The weekend overview (app/weekend.py)."""

from app import weekend
from app.schemas import Lap


def lap(driver: str, number: int, time: float | None, position: int | None = None) -> Lap:
    base = {name: None for name in Lap.model_fields}
    base |= {"personal_best": False, "deleted": False, "accurate": True}
    base |= {"pit_in": False, "pit_out": False, "driver": driver, "lap": number}
    return Lap(**(base | {"lap_time": time, "position": position, "start_time": 0.0}))


def test_practice_by_best_lap_and_a_race_by_the_finish() -> None:
    laps = [lap("VER", 1, 80.5, 2), lap("VER", 2, 80.0, 2), lap("NOR", 1, 80.2, 1)]
    practice = weekend.classification("FP2", laps)
    assert (practice["VER"].position, practice["NOR"].position) == (1, 2)
    assert practice["NOR"].gap == 0.2
    race = weekend.classification("R", laps)
    assert (race["NOR"].position, race["VER"].position) == (1, 2)
