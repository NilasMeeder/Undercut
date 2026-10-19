from datetime import UTC, datetime

from app import radio
from app.live import convert
from app.live.feed import Message

T0 = datetime(2025, 9, 7, 12, 5, 44, tzinfo=UTC)


def test_clips_in_time_order_on_the_session_clock():
    columns = {
        "drv": ["HAM", "VER", None],
        "date": ["2025-09-07T12:14:28.573000+00:00", "2025-09-07T12:13:58.510000+00:00", None],
        "file": ["HAM/radio/a.mp3", "VER/radio/b.mp3", "x"],
    }
    clips = radio.clips(columns, T0)
    assert [(c.id, c.driver) for c in clips] == [(1, "VER"), (0, "HAM")]
    assert clips[0].t == (datetime(2025, 9, 7, 12, 13, 58, 510000, tzinfo=UTC) - T0).total_seconds()
    assert radio.clips(columns, None)[0].t is None


def test_team_radio_from_the_feed():
    path = "2025/2025-09-07_Italian_Grand_Prix/2025-09-07_Race/"
    messages = [
        Message("SessionInfo", {"Path": path}, None),
        Message(
            "TeamRadio",
            {
                "Captures": [
                    {
                        "Utc": "2025-09-07T12:13:58.51Z",
                        "RacingNumber": "1",
                        "Path": "TeamRadio/MAXVER01_1_20250907_141343.mp3",
                    }
                ]
            },
            None,
        ),
        Message(
            "TeamRadio",
            {
                "Captures": {
                    "1": {
                        "Utc": "2025-09-07T12:14:28.573Z",
                        "RacingNumber": "44",
                        "Path": "TeamRadio/LEWHAM01_44_20250907_141357.mp3",
                    }
                }
            },
            T0,
        ),
        Message(
            "TeamRadio",
            {
                "Captures": {
                    "2": {"Utc": "2025-09-07T12:15:00Z", "RacingNumber": "99", "Path": "x.mp3"}
                }
            },
            T0,
        ),
    ]
    columns = convert.team_radio_columns(messages, {"1": "VER", "44": "HAM"})
    assert columns["drv"] == ["VER", "HAM"]
    assert columns["file"][0] == "VER/radio/MAXVER01_1_20250907_141343.mp3"
    assert columns["url"][1] == (
        f"https://livetiming.formula1.com/static/{path}TeamRadio/LEWHAM01_44_20250907_141357.mp3"
    )
    assert [c.driver for c in radio.clips(columns, T0)] == ["VER", "HAM"]
