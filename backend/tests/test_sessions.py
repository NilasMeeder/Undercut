import pytest

from app import sessions
from app.schemas import Lap
from app.sources import tracinginsights as ti


def lap(driver: str, number: int, time: float | None, deleted: bool = False) -> Lap:
    return Lap(
        driver=driver,
        lap=number,
        lap_time=time,
        sector_1=None,
        sector_2=None,
        sector_3=None,
        compound=None,
        tyre_life=None,
        fresh_tyre=None,
        stint=None,
        personal_best=False,
        deleted=deleted,
        deleted_reason=None,
        accurate=True,
        pit_in=False,
        pit_out=False,
        track_status=None,
        quali_segment=None,
        position=None,
        speed_i1=None,
        speed_i2=None,
        speed_finish=None,
        speed_trap=None,
        start_time=None,
    )


def test_fastest_lap_skips_deleted_and_untimed_laps() -> None:
    laps = [
        lap("VER", 1, None),
        lap("VER", 2, 79.5),
        lap("VER", 3, 78.1, deleted=True),
        lap("VER", 4, 78.9),
        lap("NOR", 2, 70.0),
    ]
    assert sessions.fastest_lap(laps, "VER") == 4


def test_fastest_lap_without_timed_laps_raises() -> None:
    with pytest.raises(LookupError):
        sessions.fastest_lap([lap("VER", 1, None)], "VER")


def test_parse_lap_refs() -> None:
    assert sessions.parse_lap_refs("ver:17, NOR:fastest,LEC") == [
        ("VER", 17),
        ("NOR", "fastest"),
        ("LEC", "fastest"),
    ]


@pytest.mark.parametrize("spec", ["", "VERS:1", "V3R:1", "VER:abc", ",,"])
def test_parse_lap_refs_rejects_bad_input(spec: str) -> None:
    with pytest.raises(ValueError):
        sessions.parse_lap_refs(spec)


def test_clean_maps_none_strings() -> None:
    assert ti.clean("None") is None
    assert ti.clean(0) == 0
    assert ti.clean("SOFT") == "SOFT"
