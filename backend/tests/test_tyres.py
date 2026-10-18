"""Tyre sets chained over a weekend (app/tyres.py)."""

from app import tyres
from app.tyres import Stint


def stint(session: str, compound: str, fresh: bool, first: int, last: int) -> Stint:
    return Stint(session, 1, compound, fresh, first, last, last - first + 1)


def test_a_used_stint_continues_the_set_whose_age_it_carries_on() -> None:
    sets = tyres.chain(
        [
            stint("FP2", "SOFT", True, 1, 5),
            stint("Q", "SOFT", True, 1, 3),
            stint("Q", "SOFT", False, 4, 6),  # the Q set after the pit stop, not the FP2 one
            stint("Q", "SOFT", False, 7, 9),  # still the Q set (6 → 7), not FP2's (5)
            stint("R", "SOFT", False, 6, 20),  # the FP2 set (5 → 6) in the race
            stint("R", "HARD", False, 3, 30),  # used, but never seen before
        ]
    )
    assert [(s.compound, s.new_in, s.life) for s in sets] == [
        ("SOFT", "FP2", 20),
        ("SOFT", "Q", 9),
        ("HARD", None, 30),
    ]
    assert [u.session for u in sets[0].uses] == ["FP2", "R"]
