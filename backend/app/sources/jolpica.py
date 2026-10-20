"""Jolpica (api.jolpi.ca), the Ergast successor: race results, used for the starting grid.

TracingInsights has no grid. Responses are cached gzipped on disk once they have results, so a
finished race is fetched once.
"""

import gzip
import json
from pathlib import Path
from typing import Any

import requests

from app.config import HTTP_TIMEOUT_SECONDS, JOLPICA_BASE_URL, JOLPICA_CACHE_DIR
from app.sources.tracinginsights import SourceNotAvailable

PIT_LANE_START = 99
"""Grid 0 in Ergast means a pit-lane start: behind everyone on the grid."""

_http = requests.Session()
_http.headers["User-Agent"] = "f1dash (hobby project)"


def parse_grid(data: dict[str, Any], sprint: bool) -> dict[str, int]:
    """Driver code -> starting position, from a results or sprint response."""
    races = data.get("MRData", {}).get("RaceTable", {}).get("Races", [])
    if not races:
        return {}
    results = races[0].get("SprintResults" if sprint else "Results", [])
    grid: dict[str, int] = {}
    for result in results:
        code = result.get("Driver", {}).get("code")
        try:
            position = int(result.get("grid", ""))
        except ValueError:
            continue
        if code:
            grid[code] = position or PIT_LANE_START
    return grid


def _cache_path(year: int, round_number: int, sprint: bool) -> Path:
    kind = "sprint" if sprint else "race"
    return JOLPICA_CACHE_DIR / str(year) / f"{round_number}-{kind}.json.gz"


def starting_grid(year: int, round_number: int, sprint: bool = False) -> dict[str, int]:
    path = _cache_path(year, round_number, sprint)
    if path.exists():
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return parse_grid(json.load(f), sprint)
    url = f"{JOLPICA_BASE_URL}/{year}/{round_number}/{'sprint' if sprint else 'results'}.json"
    try:
        response = _http.get(url, timeout=HTTP_TIMEOUT_SECONDS)
        response.raise_for_status()
        data = response.json()
    except (requests.RequestException, ValueError) as error:
        raise SourceNotAvailable(f"No starting grid from Jolpica: {error}") from error
    grid = parse_grid(data, sprint)
    if grid:
        path.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(path, "wt", encoding="utf-8") as f:
            json.dump(data, f, separators=(",", ":"))
    return grid


# --- Standings ------------------------------------------------------------------------------------


def _fetch(path: str, cache: Path) -> dict[str, Any]:
    """A Jolpica response, cached once it has data (standings of a past round do not change)."""
    if cache.exists():
        with gzip.open(cache, "rt", encoding="utf-8") as f:
            return json.load(f)
    try:
        response = _http.get(f"{JOLPICA_BASE_URL}/{path}", timeout=HTTP_TIMEOUT_SECONDS)
        response.raise_for_status()
        data = response.json()
    except (requests.RequestException, ValueError) as error:
        raise SourceNotAvailable(f"Nothing from Jolpica ({path}): {error}") from error
    table = data.get("MRData", {})
    if table.get("StandingsTable", {}).get("StandingsLists") or table.get("RaceTable", {}).get(
        "Races"
    ):
        cache.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(cache, "wt", encoding="utf-8") as f:
            json.dump(data, f, separators=(",", ":"))
    return data


def _standings_list(data: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    lists = data.get("MRData", {}).get("StandingsTable", {}).get("StandingsLists", [])
    return lists[0].get(kind, []) if lists else []


def driver_standings(year: int, round_number: int) -> dict[str, tuple[float, int, str]]:
    """Driver code -> (points, wins, constructorId) after the round."""
    cache = JOLPICA_CACHE_DIR / str(year) / f"{round_number}-drivers.json.gz"
    out: dict[str, tuple[float, int, str]] = {}
    for row in _standings_list(_fetch(f"{year}/{round_number}/driverStandings.json", cache),
                               "DriverStandings"):  # fmt: skip
        code = row.get("Driver", {}).get("code")
        teams = row.get("Constructors") or [{}]
        if code:
            out[code] = (float(row["points"]), int(row["wins"]), teams[-1].get("constructorId", ""))
    return out


def constructor_standings(year: int, round_number: int) -> dict[str, tuple[float, int, str]]:
    """constructorId -> (points, wins, name) after the round."""
    cache = JOLPICA_CACHE_DIR / str(year) / f"{round_number}-constructors.json.gz"
    data = _fetch(f"{year}/{round_number}/constructorStandings.json", cache)
    return {
        row["Constructor"]["constructorId"]: (
            float(row["points"]),
            int(row["wins"]),
            row["Constructor"].get("name", ""),
        )
        for row in _standings_list(data, "ConstructorStandings")
    }


def sprint_results(year: int, round_number: int) -> dict[str, tuple[float, str]]:
    """Driver code -> (points, constructorId) in the round's sprint; empty without one."""
    cache = _cache_path(year, round_number, sprint=True)
    data = _fetch(f"{year}/{round_number}/sprint.json", cache)
    races = data.get("MRData", {}).get("RaceTable", {}).get("Races", [])
    out: dict[str, tuple[float, str]] = {}
    for row in races[0].get("SprintResults", []) if races else []:
        code = row.get("Driver", {}).get("code")
        if code:
            out[code] = (
                float(row.get("points", 0)),
                row.get("Constructor", {}).get("constructorId", ""),
            )
    return out
