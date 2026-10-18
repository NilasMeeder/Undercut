"""A whole (small) session through the live path: archive -> simulator -> feed lines -> FastF1's
parsers -> convert.lap_columns, and the laps come out as they went in. No network: FastF1 gets a
made-up schedule, and the archive is fake."""

import socket
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import fastf1
import pandas as pd
import pytest
from fastf1.events import EventSchedule

from app import replays, schedule, sessions
from app.live import convert, feed, simulate
from app.schemas import EventInfo, SessionInfo
from app.sources import tracinginsights as ti

EVENT = EventInfo(
    round=1,
    name="Test Grand Prix",
    country="Testland",
    location="Testville",
    format="conventional",
    date="2025-03-16T00:00:00",
    sessions=[SessionInfo(code="R", name="Race", start_utc=None, utc_offset=60)],
)
T0 = pd.Timestamp("2025-03-16 14:00:00", tz="UTC").to_pydatetime()
START = 100.0  # session time of the race start
FIRST = {"VER": 61.0, "NOR": 61.4}
LAPS = {"VER": [59.0, 59.5], "NOR": [59.3, 79.6]}  # NOR's last lap is through the pit lane
SPLIT = (0.33, 0.34, 0.33)


def race_laps() -> dict[str, list[Any]]:
    """session_laptimes.json for a three-lap race of two cars; NOR stops at the end of lap 2."""
    cols: dict[str, list[Any]] = {}

    def add(**row: Any) -> None:
        for key, value in row.items():
            cols.setdefault(key, []).append(value)

    for driver, number, team in (("VER", "1", "RB"), ("NOR", "4", "McL")):
        start = START
        times = [FIRST[driver], *LAPS[driver]]
        for lap, time in enumerate(times, start=1):
            s1, s2, s3 = (round(time * f, 3) for f in SPLIT)
            s3 = round(time - s1 - s2, 3)
            end = round(start + time, 3)
            pitting = driver == "NOR" and lap == 2
            out_lap = driver == "NOR" and lap == 3
            add(
                drv=driver,
                dNum=number,
                team=team,
                lap=lap,
                time=time,
                s1=s1,
                s2=s2,
                s3=s3,
                s1T=round(start + s1, 3),
                s2T=round(start + s1 + s2, 3),
                s3T=end,
                lST=start,
                sesT=end,
                lSD=(T0 + timedelta(seconds=start)).strftime("%Y-%m-%dT%H:%M:%S.%f"),
                compound="HARD" if out_lap else "MEDIUM",
                stint=2 if out_lap else 1,
                life=1 if out_lap else lap,
                fresh=True,
                pos=None,
                pin=round(end - 5.0, 3) if pitting else None,
                pout=round(start + 18.0, 3) if out_lap else None,
                status="1",
                pb=lap == 2,
                vi1=300.0,
                vi2=280.0,
                vfl=290.0,
                vst=330.0,
                **{"del": False, "delR": None, "iacc": not (pitting or out_lap)},
            )
            start = end
    # Positions at the line: whoever crossed first on that lap.
    n = len(cols["lap"])
    for i in range(n):
        ahead = [
            j
            for j in range(n)
            if cols["lap"][j] == cols["lap"][i] and cols["sesT"][j] < cols["sesT"][i]
        ]
        cols["pos"][i] = 1 + len(ahead)
    return cols


ARCHIVE = {
    "session_laptimes.json": race_laps(),
    "drivers.json": {
        "drivers": [
            {
                "driver": "VER",
                "dn": "1",
                "fn": "Max",
                "ln": "Verstappen",
                "team": "RB",
                "tc": "4781D7",
            },
            {
                "driver": "NOR",
                "dn": "4",
                "fn": "Lando",
                "ln": "Norris",
                "team": "McL",
                "tc": "F47600",
            },
        ]
    },
}


@pytest.fixture
def archive(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    def fake_fetch(year: int, event: str, session: str, file: str):
        if file not in ARCHIVE:
            raise ti.SourceNotAvailable(f"{file} not in the test archive")
        return ARCHIVE[file]

    def no_network(*args: Any, **kwargs: Any) -> None:
        raise OSError("no network in this test")

    row: dict[str, Any] = {
        "RoundNumber": 1,
        "Country": "Testland",
        "Location": "Testville",
        "OfficialEventName": "Test Grand Prix",
        "EventDate": pd.Timestamp("2025-03-16"),
        "EventName": "Test Grand Prix",
        "EventFormat": "conventional",
        "Session1": "Race",
        "Session1Date": pd.Timestamp("2025-03-16 15:00+01:00"),
        "Session1DateUtc": pd.Timestamp("2025-03-16 14:00"),
        "F1ApiSupport": True,
    }
    for i in range(2, 6):
        row.update({f"Session{i}": "", f"Session{i}Date": pd.NaT, f"Session{i}DateUtc": pd.NaT})
    event = EventSchedule(pd.DataFrame([row]), year=2025).get_event_by_round(1)

    monkeypatch.setattr(socket.socket, "connect", no_network)
    monkeypatch.setattr(ti, "fetch_json", fake_fetch)
    monkeypatch.setattr(ti, "READ_LIVE", False)
    monkeypatch.setattr(schedule, "resolve_session", lambda y, r, c: (EVENT, EVENT.sessions[0]))
    monkeypatch.setattr(replays, "starting_grid", lambda y, r, c: {"VER": 1, "NOR": 2})
    monkeypatch.setattr(fastf1, "get_session", lambda y, r, c: event.get_session("Race"))
    caches = (sessions.folders, sessions.get_t0, sessions.get_detail, sessions.get_laps)
    for cached in (*caches, replays.get_timeline):
        cached.cache_clear()
    yield
    for cached in (*caches, replays.get_timeline):
        cached.cache_clear()


def converted_laps() -> dict[str, list[Any]]:
    sim = simulate.Simulation(2025, 1, "R")
    messages = [m for _, line in simulate.lines(sim) if (m := feed.parse_line(line))]
    livedata = convert.live_timing_data(messages, sim.t0, skip=convert.TELEMETRY_TOPICS)
    with fastf1.Cache.disabled():
        session = convert.load_session(2025, 1, "R", livedata, telemetry=False)
    return convert.lap_columns(session, sim.t0)


def rows(cols: dict[str, list[Any]], keys: tuple[str, ...]) -> list[tuple[Any, ...]]:
    found = sorted(zip(*(cols[k] for k in keys), strict=True), key=lambda r: (r[0], r[1]))
    return [tuple(round(v, 3) if isinstance(v, float) else v for v in row) for row in found]


def test_a_simulated_race_converts_back_to_its_laps(archive: None) -> None:
    out = converted_laps()
    keys = ("drv", "lap", "time", "s1", "s2", "s3", "compound", "stint", "life", "pos")
    assert rows(out, keys) == rows(ARCHIVE["session_laptimes.json"], keys)
    times = ("drv", "lap", "lST", "sesT", "s1T", "s2T")
    assert rows(out, times) == rows(ARCHIVE["session_laptimes.json"], times)
    # The pit stop: in at the end of NOR's lap 2, out on lap 3.
    cols = (out["drv"], out["lap"], out["pin"], out["pout"])
    pits = {(d, n): (i, o) for d, n, i, o in zip(*cols, strict=True)}
    assert pits[("NOR", 2)][0] == pytest.approx(START + 61.4 + 59.3 - 5.0, abs=0.5)
    assert pits[("NOR", 3)][1] == pytest.approx(START + 61.4 + 59.3 + 18.0, abs=0.5)
    assert pits[("VER", 2)] == (None, None)
