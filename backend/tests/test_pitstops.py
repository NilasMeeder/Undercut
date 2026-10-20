"""Time stood still in the pit box: from F1's PitStopSeries, or measured in the telemetry."""

import numpy as np

from app.live import convert
from app.live.feed import Message
from app.pitstops import stationary


def test_stood_still_in_the_telemetry() -> None:
    times = np.array([10.0, 10.2, 10.4, 10.6, 10.8, 11.0, 13.0, 13.2, 13.4, 30.0])
    speeds = np.array([40.0, 20.0, 5.0, 0.0, 0.0, 0.3, 0.0, 6.0, 20.0, 0.0])
    # From halfway 10.4-10.6 to halfway 13.0-13.2; the stop at 30 s is after pit exit.
    assert stationary(times, speeds, pit_in=9.0, pit_out=20.0) == 2.6
    assert stationary(times, np.full(10, 80.0), 9.0, 20.0) is None  # a drive-through


def test_f1s_pit_stop_series() -> None:
    messages = [
        Message(
            "PitStopSeries",
            {
                "PitTimes": {
                    "1": [
                        {
                            "Timestamp": "2026-10-25T20:01:02Z",
                            "PitStop": {
                                "RacingNumber": "1",
                                "PitStopTime": "2.4",
                                "PitLaneTime": "22.1",
                                "Lap": "17",
                            },
                        }
                    ]
                }
            },
            None,
        ),
        # An update: a dict by index, the second stop arriving in parts.
        Message("PitStopSeries", {"PitTimes": {"1": {"1": {"PitStop": {"Lap": "38"}}}}}, None),
        Message(
            "PitStopSeries", {"PitTimes": {"1": {"1": {"PitStop": {"PitStopTime": "3.1"}}}}}, None
        ),
        Message("PitStopSeries", {"PitTimes": {"81": {"0": {"PitStop": {"Lap": "x"}}}}}, None),
    ]
    assert convert.pit_stop_columns(messages, {"1": "VER", "81": "PIA"}) == {
        "drv": ["VER", "VER"],
        "lap": [17, 38],
        "stationary": [2.4, 3.1],
        "lane": [22.1, None],
    }
