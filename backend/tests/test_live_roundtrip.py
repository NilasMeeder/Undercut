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
from app.live import convert, feed, simulate, tower
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
START = 4000.0  # session time of the race start (late, as when the recording starts at 13:00)
FIRST = {"VER": 61.0, "NOR": 61.4}
LAPS = {"VER": [59.0, 59.5, 59.2], "NOR": [59.3, 59.6, 79.6]}  # NOR stops after lap 3
SPLIT = (0.33, 0.34, 0.33)


def race_laps() -> dict[str, list[Any]]:
    """session_laptimes.json for a four-lap race of two cars; NOR stops at the end of lap 3."""
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
            pitting = driver == "NOR" and lap == 3
            out_lap = driver == "NOR" and lap == 4
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


LAP_LENGTH = 5000.0


def lap_telemetry(laps: dict[str, list[Any]]) -> dict[str, Any]:
    """<DRV>/<lap>_tel.json: time and distance at a constant speed (the simulator's mini-sectors
    come from them)."""
    out = {}
    for driver, lap, time in zip(laps["drv"], laps["lap"], laps["time"], strict=True):
        steps = [i / 10 for i in range(11)]
        tel = {"time": [time * f for f in steps], "distance": [LAP_LENGTH * f for f in steps]}
        out[f"{driver}/{lap}_tel.json"] = {"tel": tel}
    return out


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
ARCHIVE |= lap_telemetry(ARCHIVE["session_laptimes.json"])


@pytest.fixture
def archive(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    connections: list[Any] = []

    def fake_fetch(year: int, event: str, session: str, file: str):
        if file not in ARCHIVE:
            raise ti.SourceNotAvailable(f"{file} not in the test archive")
        return ARCHIVE[file]

    def no_network(sock: socket.socket, address: Any) -> None:
        connections.append(address)
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
    # Not even Ergast (FastF1 asks it for results and lap 1 times on every load).
    assert connections == []


def converted_laps(join: float | None = None) -> dict[str, list[Any]]:
    sim = simulate.Simulation(2025, 1, "R")
    lines = simulate.lines(sim, join)
    messages, joined = convert.joined_late([m for _, line in lines if (m := feed.parse_line(line))])
    livedata = convert.live_timing_data(messages, sim.t0, skip=convert.TELEMETRY_TOPICS)
    with fastf1.Cache.disabled():
        session = convert.load_session(2025, 1, "R", livedata, False, joined=joined is not None)
    return convert.lap_columns(session, sim.t0, joined)


def rows(cols: dict[str, list[Any]], keys: tuple[str, ...]) -> list[tuple[Any, ...]]:
    found = sorted(zip(*(cols[k] for k in keys), strict=True), key=lambda r: (r[0], r[1]))
    return [tuple(round(v, 3) if isinstance(v, float) else v for v in row) for row in found]


def test_a_simulated_race_converts_back_to_its_laps(archive: None) -> None:
    out = converted_laps()
    keys = ("drv", "lap", "time", "s1", "s2", "s3", "compound", "stint", "life", "pos")
    assert rows(out, keys) == rows(ARCHIVE["session_laptimes.json"], keys)
    times = ("drv", "lap", "lST", "sesT", "s1T", "s2T")
    assert rows(out, times) == rows(ARCHIVE["session_laptimes.json"], times)
    # The pit stop: in at the end of NOR's lap 3, out on lap 4.
    assert pits(out)[("NOR", 3)][0] == pytest.approx(NOR_STOP - 5.0, abs=0.5)
    assert pits(out)[("NOR", 4)][1] == pytest.approx(NOR_STOP + 18.0, abs=0.5)
    assert pits(out)[("VER", 3)] == (None, None)


NOR_STOP = START + 61.4 + 59.3 + 59.6
"""Where NOR crosses the line in the pit lane."""


def pits(cols: dict[str, list[Any]]) -> dict[tuple[str, int], tuple[Any, Any]]:
    by_lap = zip(cols["drv"], cols["lap"], cols["pin"], cols["pout"], strict=True)
    return {(d, n): (i, o) for d, n, i, o in by_lap}


@pytest.mark.parametrize(
    ("join", "wanted"),
    [
        # VER has just finished lap 2, NOR not yet: FastF1's lap 1 is a different lap for each,
        # and it aligns the cars on those.
        (START + 120.3, {("VER", 3), ("VER", 4), ("NOR", 2), ("NOR", 3), ("NOR", 4)}),
        # NOR is in the pit lane: FastF1 only counts laps once a car has left the pits.
        (NOR_STOP - 3.0, {("VER", 3), ("VER", 4), ("NOR", 3), ("NOR", 4)}),
    ],
)
def test_a_recording_that_starts_late_numbers_laps_as_f1(
    archive: None, join: float, wanted: set[tuple[str, int]]
) -> None:
    # FastF1 counts laps from 1 and would make a lap of F1's state.
    out = converted_laps(join)
    keys = ("drv", "lap", "time", "lST", "sesT")
    archived = rows(ARCHIVE["session_laptimes.json"], keys)
    assert rows(out, keys) == [row for row in archived if (row[0], row[1]) in wanted]
    # VER's lap 4 is all after the start of the recording.
    by_lap = zip(out["drv"], out["lap"], out["s1"], out["s2"], strict=True)
    sectors = {(d, n): (a, b) for d, n, a, b in by_lap}
    assert sectors[("VER", 4)] == (round(59.2 * 0.33, 3), round(59.2 * 0.34, 3))
    assert pits(out)[("NOR", 4)][1] == pytest.approx(NOR_STOP + 18.0, abs=0.5)


def test_the_simulator_sends_mini_sectors_as_f1(archive: None) -> None:
    sim = simulate.Simulation(2025, 1, "R")
    feed_tower = tower.FeedTower()
    for at, line in simulate.lines(sim):
        message = feed.parse_line(line)
        if message is not None and message.topic == "TimingData":
            feed_tower.add_timing(at, message.data)
    ver_lap_2 = START + FIRST["VER"] + LAPS["VER"][0]
    # VER's lap 2 is the fastest so far everywhere: all purple, until his lap 3 clears them.
    segments = tower.decode_segments(feed_tower.at(ver_lap_2 + 0.5)["1"].segments)
    assert [len(row) for row in segments] == [6, 7, 6]
    assert {s for row in segments for s in row} == {"best"}
    # NOR's in-lap ends in the pit lane (in at -5 s), and his out-lap starts in it (out at +18 s,
    # a segment takes ~4.2 s).
    in_lap = tower.decode_segments(feed_tower.at(NOR_STOP + 0.5)["4"].segments)
    assert in_lap[2][-2:] == ["pit", "pit"] and in_lap[2][-3] != "pit"
    out_lap = tower.decode_segments(feed_tower.at(NOR_STOP + 15.0)["4"].segments)
    assert out_lap[0] == ["pit"] * 3 + ["none"] * 3
