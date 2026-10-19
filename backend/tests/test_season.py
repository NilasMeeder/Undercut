from app import season
from app.schemas import DriverInfo
from tests.test_replay import make_lap


def q(driver: str, part: str, time: float, n: int, **kw):
    return make_lap(driver, n, lap_time=time, quali_segment=part, **kw)


def info(code: str, team: str) -> DriverInfo:
    return DriverInfo(
        code=code,
        number="1",
        first_name="",
        last_name="",
        team=team,
        color="#ff0000",
        headshot_url=None,
    )


DRIVERS = [info("VER", "Red Bull"), info("TSU", "Red Bull")]


def test_compared_in_the_last_part_both_reached():
    laps = [
        q("VER", "Q1", 80.5, 3),
        q("VER", "Q2", 80.2, 6),
        q("VER", "Q3", 79.9, 9),
        q("TSU", "Q1", 80.4, 3),
        q("TSU", "Q2", 80.6, 6),
    ]
    [(key, d)] = season.round_duels(1, laps, DRIVERS).items()
    assert key == ("Red Bull", "TSU", "VER")
    # Q2, not Q3 (TSU did not get there) or Q1 (where TSU was quicker).
    assert d.segment == "Q2" and d.a == 80.6 and d.b == 80.2 and d.gap == -0.4
    assert d.ahead == 1  # VER got further


def test_a_deleted_lap_does_not_count_and_a_big_gap_is_no_pace():
    laps = [
        q("VER", "Q1", 80.0, 3),
        q("TSU", "Q1", 79.0, 3, deleted=True),
        q("TSU", "Q1", 84.0, 4),
    ]
    [d] = season.round_duels(1, laps, DRIVERS).values()
    assert d.a == 84.0 and d.gap is None and d.ahead == 1


def test_season_pairs_head_to_head_first():
    r1 = season.round_duels(1, [q("VER", "Q3", 79.9, 9), q("TSU", "Q3", 80.3, 9)], DRIVERS)
    r2 = season.round_duels(2, [q("VER", "Q3", 79.0, 9), q("TSU", "Q3", 79.1, 9)], DRIVERS)
    # TSU out on track but without a time (a crash on his first lap).
    r3 = season.round_duels(
        3, [q("VER", "Q1", 80.0, 3), make_lap("TSU", 1, lap_time=None, quali_segment="Q1")], DRIVERS
    )
    [pair] = season.pairs([1, 2, 3, 4], {1: r1, 2: r2, 3: r3}, {"Red Bull": "#123456"})
    assert pair.drivers == ["VER", "TSU"] and pair.ahead == [3, 0]
    assert [d and d.gap for d in pair.duels] == [0.4, 0.1, None, None]
    assert pair.median_gap == 0.25 and pair.color == "#123456"
