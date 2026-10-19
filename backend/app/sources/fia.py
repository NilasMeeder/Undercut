"""Straight-mode zones (2026) from the FIA's circuit map per event.

    uv run python -m app.sources.fia 2026 18        # one event (round number)
    uv run python -m app.sources.fia 2026 --all     # every event the FIA has published

The zones are not in any data feed. The Race Director publishes them per event as "Competition
Notes - Circuit Map" (fia.com/documents, season, event), a PDF with a table: per zone (A1, A2…)
where straight mode may be switched on ("30m after T11"), with normal grip and in low-grip
conditions, and where overtake mode is detected and activated (one of each per lap). Zones have
no end in the table (only on the drawing). This reads that table and writes
`app/straight_mode.json`, which is in git: check the result against the map before committing.
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
class Overtake:
    """Overtake mode (2026, races): a car within 1 s of the car ahead at the detection line gets
    the extra MGU-K energy, to use from the activation line."""

    detection: Activation
    activation: Activation


@dataclass(frozen=True)
class CircuitMap:
    zones: list[Zone]
    overtake: Overtake | None
    """None where the map has no overtake points."""


_HEADINGS = re.compile(r"(ACTIVATION\s+DETECTION)|DETECTION\s+ACTIVATION")
"""The table's headings for the overtake points (the legend says OVERTAKE ACTIVATION)."""


def overtake(text: str) -> Overtake | None:
    """The overtake points: the first two '- ' points after the table's ACTIVATION and DETECTION
    headings, in the order pypdf reads those headings (always activation first so far, while the
    drawing lists detection first: Monza 'T11' is after 'Entry T11', where OT A and OT D are
    drawn). Points after them are the speed trap and intermediates (Australia)."""
    headings = _HEADINGS.search(text)
    if headings is None:
        return None
    order = ["ACTIVATION", "DETECTION"] if headings.group(1) else ["DETECTION", "ACTIVATION"]
    end = text.find("LEGEND", headings.end())
    after = text[headings.end() : end if end > 0 else None]
    points = [
        point
        for dash, token in _TOKEN.findall(after)
        if dash and (point := activation(" ".join(token.split()))) is not None
    ][:2]
    if len(points) < 2:
        return None
    found = dict(zip(order, points, strict=True))
    return Overtake(detection=found["DETECTION"], activation=found["ACTIVATION"])


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
        # Monaco: no stretch long enough for straight mode, but overtake mode.
        return CircuitMap(zones=[], overtake=overtake(text))
    end = text.find("LEGEND", start)
    table = text[start : end if end > 0 else None]
    labels = re.findall(r"ZONE\s+(A\d+)", table)
    after = table[table.rfind("ZONE") :]
    values = [" ".join(token.split()) for dash, token in _TOKEN.findall(after) if not dash]
    if len(values) != 2 * len(labels):
        raise ValueError(f"{len(labels)} zones but {len(values)} activation points: {values}")
    zones = []
    for i, label in enumerate(labels):
        normal = activation(values[i])
        if normal is not None:  # n/a: a zone on the drawing that is not in use
            low_grip = activation(values[len(labels) + i])
            zones.append(Zone(label=label, normal=normal, low_grip=low_grip))
    return CircuitMap(zones=zones, overtake=overtake(text))


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


def keep_by_hand(new: dict, old: dict | None) -> dict:
    """A map read again keeps what was added by hand: a zone's `end` from the drawing, a `note`,
    and overtake points the text did not have."""
    if not old:
        return new
    ends = {z["label"]: z["end"] for z in old.get("zones", []) if z.get("end")}
    for zone in new["zones"]:
        if zone["label"] in ends:
            zone["end"] = ends[zone["label"]]
    if new.get("overtake") is None and isinstance(old.get("overtake"), dict):
        new["overtake"] = old["overtake"]
    if "note" in old:
        new["note"] = old["note"]
    return new


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
        season[event.name] = keep_by_hand(
            {"round": event.round, "source": url, **asdict(circuit_map)}, season.get(event.name)
        )
        zones = ", ".join(
            f"{z.label} {z.normal.text}"
            + (f" (low grip {z.low_grip.text})" if z.low_grip else " (low grip: none)")
            for z in circuit_map.zones
        )
        ot = circuit_map.overtake
        overtakes = (
            f"overtake detection {ot.detection.text}, activation {ot.activation.text}"
            if ot
            else "no overtake points"
        )
        print(f"{event.round:2d} {event.name}: {zones or 'no zones'}; {overtakes}")
    save(data)
    print(f"Written to {ZONES_FILE}: check it against the maps before committing.")


if __name__ == "__main__":
    main()
