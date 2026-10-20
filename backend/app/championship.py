"""The championship as it stands: the standings before a race or sprint, and the points it gives.
The frontend adds the points of the order at the session clock (the tower), so it moves with the
replay and live.

Before = Jolpica's standings after the previous round, plus this weekend's sprint for the race.
Teams carry the session's names (drivers.json), so a driver and his constructor line up with the
rest of the dashboard; a constructor without a driver here keeps Jolpica's name.
"""

from app import sessions
from app.generations import session_cache
from app.schemas import Championship, ChampionshipEntry
from app.sources import jolpica

RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1]
SPRINT_POINTS_2021 = [3, 2, 1]
FASTEST_LAP_YEARS = range(2019, 2025)
"""A point for the fastest lap if in the top 10 (races, 2019 to 2024)."""


def points_table(year: int, code: str) -> list[int]:
    if code == "S":
        return SPRINT_POINTS_2021 if year == 2021 else SPRINT_POINTS
    return RACE_POINTS


@session_cache(maxsize=8)
def get_championship(year: int, round_number: int, code: str) -> Championship:
    if code not in ("R", "S"):
        raise LookupError("The championship counts races and sprints only")
    detail = sessions.get_detail(year, round_number, code)
    team_of = {d.code: d.team for d in detail.drivers}

    after = round_number - 1
    drivers = jolpica.driver_standings(year, after) if after > 0 else {}
    constructors = jolpica.constructor_standings(year, after) if after > 0 else {}
    sprint = jolpica.sprint_results(year, round_number) if code == "R" else {}

    # constructorId -> the session's team name, through the drivers in both.
    names: dict[str, str] = {}
    for code_, (_, _, constructor) in drivers.items():
        if code_ in team_of:
            names.setdefault(constructor, team_of[code_])
    for code_, (_, constructor) in sprint.items():
        if code_ in team_of:
            names.setdefault(constructor, team_of[code_])

    points: dict[str, float] = {}
    wins: dict[str, int] = {}
    team: dict[str, str] = {}
    for driver, (total, won, constructor) in drivers.items():
        points[driver], wins[driver] = total, won
        team[driver] = team_of.get(driver) or names.get(constructor, constructor)
    team_points: dict[str, float] = {}
    team_wins: dict[str, int] = {}
    for constructor, (total, won, name) in constructors.items():
        key = names.get(constructor, name)
        team_points[key] = team_points.get(key, 0.0) + total
        team_wins[key] = team_wins.get(key, 0) + won
    for driver, (scored, constructor) in sprint.items():
        points[driver] = points.get(driver, 0.0) + scored
        team.setdefault(driver, team_of.get(driver) or names.get(constructor, constructor))
        key = names.get(constructor, constructor)
        team_points[key] = team_points.get(key, 0.0) + scored
    for driver, name in team_of.items():
        team.setdefault(driver, name)
        team_points.setdefault(name, 0.0)

    before = "the start of the season" if after == 0 else f"round {after}"
    if sprint:
        before += " and the sprint"
    return Championship(
        before=before,
        points=points_table(year, code),
        fastest_lap_point=code == "R" and year in FASTEST_LAP_YEARS,
        drivers=sorted(
            (
                ChampionshipEntry(
                    name=d, team=team[d], points=points.get(d, 0.0), wins=wins.get(d, 0)
                )
                for d in team
            ),
            key=lambda e: (-e.points, -e.wins, e.name),
        ),
        teams=sorted(
            (
                ChampionshipEntry(name=t, team=t, points=p, wins=team_wins.get(t, 0))
                for t, p in team_points.items()
            ),
            key=lambda e: (-e.points, -e.wins, e.name),
        ),
    )
