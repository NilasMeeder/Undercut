"""Straight-mode zones (2026) from the FIA's circuit map per event.

    uv run python -m app.sources.fia 2026 18        # one event (round number)
    uv run python -m app.sources.fia 2026 --all     # every event the FIA has published

The zones are not in any data feed. The Race Director publishes them per event as "Competition
Notes - Circuit Map" (fia.com/documents, season, event), a PDF with a table: per zone (A1, A2…)
where straight mode may be switched on ("30m after T11"), with normal grip and in low-grip
conditions, and where overtake mode is detected and activated. Zones have no end in the table
(only on the drawing). This reads that table and writes `app/straight_mode.json`, which is in
git: check the result against the map before committing it.
"""

import argparse
import io
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import quote

import requests

from app.config import HTTP_TIMEOUT_SECONDS

ZONES_FILE = Path(__file__).resolve().parent.parent / "straight_mode.json"
FIA_BASE = "https://www.fia.com"
SEASON_PAGES = {
    2026: "/documents/championships/fia-formula-one-world-championship-14/season/season-2026-2072"
}
FIA_NAMES = {"Barcelona Grand Prix": "Barcelona-Catalunya Grand Prix"}
"""Our event name (FastF1's schedule) -> the FIA's, where they differ."""

_CORNER = r"(?:(?:Exit|Apex|Entry)(?:\s+of)?\s+)?T\d+[A-Z]?(?:[ \t]+exit)?"
"""A corner as the FIA names a point at it: 'T11', 'Exit T18', 'Exit of T17', 'T3 exit'."""
_POINT = re.compile(r"(?:(\d+)\s*m\s+(after|before)\s+)?" + _CORNER, re.IGNORECASE)
_TOKEN = re.compile(
    r"(-\s+)?((?:\d+\s*m\s+(?:after|before)\s+)?" + _CORNER + r"(?:\s*/\s*Pit Exit|-entry)?|n/a)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Activation:
    """A point "metres after (or before) corner"; `text` as the FIA writes it. At the exit or
    apex of a corner counts as at the corner: the corner positions are ±50 m anyway."""

    corner: str
    metres: float
    text: str


@dataclass(frozen=True)
class Zone:
    label: str
    """'A1', 'A2'… as on the map."""
    normal: Activation
    low_grip: Activation | None
    """Low-grip conditions: a later start, or no zone (N/A)."""


@dataclass(frozen=True)
class CircuitMap:
    zones: list[Zone]
    overtake: list[str]
    """Overtake mode activation and detection as the FIA writes them (order as in the table,
    which differs per map: not used yet)."""


def activation(text: str) -> Activation | None:
    match = _POINT.search(text)
    if match is None:
        return None
    metres = float(match.group(1) or 0)
    return Activation(
        corner=re.search(r"T(\d+[A-Z]?)", match.group(0)).group(1),  # type: ignore[union-attr]
        metres=-metres if (match.group(2) or "").lower() == "before" else metres,
        text=" ".join(text.split()),
    )


def parse(text: str) -> CircuitMap:
    """The zone table from the text of the circuit map. Layout of the text (pypdf): the zone
    names, then the normal-grip activation per zone, then the low-grip one per zone, then the
    overtake points, each of those starting with '- '. The sector data just before it has
    points too, so the table starts at its first zone."""
    if "STRAIGHT MODE" not in text:
        raise ValueError("No straight-mode table on this map")
    start = text.find("ZONE A")
    if start < 0:
        return CircuitMap(zones=[], overtake=[])  # Monaco: no stretch long enough
    end = text.find("LEGEND", start)
    table = text[start : end if end > 0 else None]
    labels = re.findall(r"ZONE\s+(A\d+)", table)
    after = table[table.rfind("ZONE") :]
    values, overtake = [], []
    for dash, token in _TOKEN.findall(after):
        (overtake if dash else values).append(" ".join(token.split()))
    if len(values) != 2 * len(labels):
        raise ValueError(f"{len(labels)} zones but {len(values)} activation points: {values}")
    zones = []
    for i, label in enumerate(labels):
        normal = activation(values[i])
        if normal is not None:  # n/a: a zone on the drawing that is not in use
            low_grip = activation(values[len(labels) + i])
            zones.append(Zone(label=label, normal=normal, low_grip=low_grip))
    return CircuitMap(zones=zones, overtake=overtake)


def pdf_text(data: bytes) -> str:
    from pypdf import PdfReader  # a dev dependency: only this script reads PDFs

    return "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages)


_http = requests.Session()
_http.headers["User-Agent"] = "Mozilla/5.0 (f1dash, hobby project)"


def _get(path: str) -> requests.Response:
    response = _http.get(FIA_BASE + path, timeout=HTTP_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response


def circuit_map_url(year: int, event: str) -> str | None:
    """The newest circuit map on the FIA's page of the event: the highest '_v2' in the name."""
    name = FIA_NAMES.get(event, event)
    page = _get(f"{SEASON_PAGES[year]}/event/{quote(name)}").text
    links = re.findall(r'href="(/system/files/decision-document/[^"]*circuit_map[^"]*\.pdf)"', page)

    def version(link: str) -> int:
        found = re.search(r"_v(\d+)", link)
        return int(found.group(1)) if found else 1

    return max(links, key=version) if links else None


def fetch(year: int, event: str) -> tuple[str, CircuitMap] | None:
    path = circuit_map_url(year, event)
    if path is None:
        return None
    return FIA_BASE + path, parse(pdf_text(_get(path).content))


def load() -> dict[str, dict]:
    if not ZONES_FILE.exists():
        return {}
    return json.loads(ZONES_FILE.read_text(encoding="utf-8"))


def save(data: dict[str, dict]) -> None:
    ZONES_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    from app import schedule

    parser = argparse.ArgumentParser(description="Straight-mode zones from the FIA circuit maps")
    parser.add_argument("year", type=int)
    parser.add_argument("round", type=int, nargs="?")
    parser.add_argument("--all", action="store_true", help="every event of the season")
    args = parser.parse_args()
    events = [
        e for e in schedule.get_season_events(args.year).events if args.all or e.round == args.round
    ]
    if not events:
        parser.error("give a round number or --all")
    data = load()
    season = data.setdefault(str(args.year), {})
    for event in events:
        try:
            found = fetch(args.year, event.name)
        except (requests.RequestException, ValueError) as error:
            print(f"{event.round:2d} {event.name}: {error}", file=sys.stderr)
            continue
        if found is None:
            print(f"{event.round:2d} {event.name}: no circuit map yet")
            continue
        url, circuit_map = found
        season[event.name] = {"round": event.round, "source": url, **asdict(circuit_map)}
        zones = ", ".join(
            f"{z.label} {z.normal.text}"
            + (f" (low grip {z.low_grip.text})" if z.low_grip else " (low grip: none)")
            for z in circuit_map.zones
        )
        print(f"{event.round:2d} {event.name}: {zones or 'no zones'}")
    save(data)
    print(f"Written to {ZONES_FILE}: check it against the maps before committing.")


if __name__ == "__main__":
    main()
