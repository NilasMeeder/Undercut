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
