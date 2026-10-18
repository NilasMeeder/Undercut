import pandas as pd

from app.schedule import schedule_to_events


def make_schedule() -> pd.DataFrame:
    row = {
        "RoundNumber": 2,
        "Country": "China",
        "Location": "Shanghai",
        "EventName": "Chinese Grand Prix",
        "EventFormat": "sprint_qualifying",
        "EventDate": pd.Timestamp("2025-03-23"),
    }
    names = ["Practice 1", "Sprint Qualifying", "Sprint", "Qualifying", "Race"]
    for i, name in enumerate(names, start=1):
        row[f"Session{i}"] = name
        row[f"Session{i}DateUtc"] = pd.Timestamp(f"2025-03-2{i} 07:00:00")
        row[f"Session{i}Date"] = pd.Timestamp(f"2025-03-2{i} 15:00:00+0800")
    return pd.DataFrame([row])


def test_session_names_map_to_codes() -> None:
    [event] = schedule_to_events(make_schedule())
    assert [s.code for s in event.sessions] == ["FP1", "SQ", "S", "Q", "R"]
    assert event.round == 2


def test_missing_sessions_are_skipped() -> None:
    schedule = make_schedule()
    schedule["Session5"] = None
    schedule["Session5DateUtc"] = pd.NaT
    [event] = schedule_to_events(schedule)
    assert [s.code for s in event.sessions] == ["FP1", "SQ", "S", "Q"]


def test_start_times_are_utc() -> None:
    [event] = schedule_to_events(make_schedule())
    assert event.sessions[0].start_utc is not None
    assert event.sessions[0].start_utc.utcoffset().total_seconds() == 0


def test_local_offset_comes_from_the_local_session_time() -> None:
    schedule = make_schedule()
    schedule["Session5Date"] = pd.Timestamp("2025-10-19 14:00:00-0500")
    schedule["Session4Date"] = pd.NaT
    [event] = schedule_to_events(schedule)
    assert event.sessions[0].utc_offset == 480
    assert event.sessions[3].utc_offset is None
    assert event.sessions[4].utc_offset == -300
