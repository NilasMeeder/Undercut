"""The standings before a race or sprint: Jolpica's after the previous round, this weekend's
sprint for the race, and team names as the session has them."""

from types import SimpleNamespace

import pytest

from app import championship, sessions
from app.sources import jolpica


@pytest.fixture
def season(monkeypatch: pytest.MonkeyPatch) -> None:
    drivers = [
        SimpleNamespace(code="VER", team="Red Bull Racing"),
        SimpleNamespace(code="TSU", team="Red Bull Racing"),
        SimpleNamespace(code="NOR", team="McLaren"),
        SimpleNamespace(code="LIN", team="Racing Bulls"),  # rookie, no points yet
    ]
    monkeypatch.setattr(sessions, "get_detail", lambda y, r, c: SimpleNamespace(drivers=drivers))
    monkeypatch.setattr(
        jolpica,
        "driver_standings",
        lambda y, r: {
            "NOR": (100.0, 2, "mclaren"),
            "VER": (100.0, 3, "red_bull"),
            "TSU": (10.0, 0, "red_bull"),
            "LAW": (4.0, 0, "red_bull"),  # replaced: still in the championship
        },
    )
    monkeypatch.setattr(
        jolpica,
        "constructor_standings",
        lambda y, r: {"mclaren": (180.0, 2, "McLaren"), "red_bull": (114.0, 3, "Red Bull")},
    )
    monkeypatch.setattr(
        jolpica, "sprint_results", lambda y, r: {"NOR": (8.0, "mclaren"), "VER": (7.0, "red_bull")}
    )
    championship.get_championship.cache_clear()


def test_the_race_after_a_sprint(season: None) -> None:
    c = championship.get_championship(2025, 19, "R")
    assert c.before == "round 18 and the sprint"
    assert c.points[:3] == [25, 18, 15] and not c.fastest_lap_point
    assert [(e.name, e.team, e.points) for e in c.drivers] == [
        ("NOR", "McLaren", 108.0),
        ("VER", "Red Bull Racing", 107.0),
        ("TSU", "Red Bull Racing", 10.0),
        ("LAW", "Red Bull Racing", 4.0),
        ("LIN", "Racing Bulls", 0.0),
    ]
    assert [(e.name, e.points) for e in c.teams] == [
        ("McLaren", 188.0),
        ("Red Bull Racing", 121.0),  # Jolpica's "Red Bull" under the session's name
        ("Racing Bulls", 0.0),
    ]


def test_the_sprint_and_ties(season: None) -> None:
    c = championship.get_championship(2025, 19, "S")
    assert c.before == "round 18" and c.points == [8, 7, 6, 5, 4, 3, 2, 1]
    assert [e.name for e in c.drivers[:2]] == ["VER", "NOR"]  # 100 each: VER has more wins
    assert championship.points_table(2021, "S") == [3, 2, 1]
    assert championship.get_championship(2024, 19, "R").fastest_lap_point


def test_the_first_round_and_other_sessions(season: None) -> None:
    c = championship.get_championship(2025, 1, "R")
    assert c.before == "the start of the season and the sprint"
    assert {e.name: e.points for e in c.drivers}["NOR"] == 8.0
    with pytest.raises(LookupError):
        championship.get_championship(2025, 19, "Q")
