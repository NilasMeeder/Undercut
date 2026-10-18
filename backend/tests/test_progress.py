"""The lap in progress at t and its live delta (app/progress.py)."""

import numpy as np
import pytest

from app import analysis, progress, sessions
from app.schemas import Lap


def trace(lap_time: float, length: float = 1000.0) -> analysis.LapTrace:
    distance = np.linspace(0.0, length, 101)
    return analysis.LapTrace(
        distance=distance,
        time=distance / length * lap_time,
        channels={"speed": np.full(101, 200.0), "gear": np.arange(101.0)},
    )


def lap(number: int, start: float, end: float, **fields) -> Lap:
    base = {name: None for name in Lap.model_fields}
    base |= {"personal_best": False, "deleted": False, "accurate": True}
    base |= {"pit_in": False, "pit_out": False, "driver": "VER", "lap": number}
    return Lap(**(base | {"start_time": start, "end_time": end, "lap_time": end - start} | fields))


def test_clip_ends_on_an_interpolated_sample_and_holds_gears() -> None:
    clipped = progress.clip(trace(60.0), 30.3)
    assert clipped is not None
    assert clipped.time[-1] == pytest.approx(30.3)
    assert clipped.distance[-1] == pytest.approx(505.0)
    assert clipped.channels["gear"][-1] == 50  # held, not interpolated
    assert progress.clip(trace(60.0), 0.0) is None
    assert progress.clip(trace(60.0), 99.0).length == pytest.approx(1000.0)


def test_on_grid_stretches_a_finished_lap_but_not_a_pit_lap() -> None:
    current = progress.clip(trace(61.0, length=1004.0), 30.5)
    assert current is not None
    plain = progress.on_grid(current, trace(60.0))
    assert plain.distance[-1] == pytest.approx(1000.0)  # the grid spans the reference
    assert plain.progress == pytest.approx(502.0)
    assert np.isnan(plain.current["speed"][-1])  # not there yet
    whole = progress.clip(trace(61.0, length=1004.0), 61.0)
    assert whole is not None
    stretched = progress.on_grid(whole, trace(60.0), length=1004.0)
    assert stretched.delta[-1] == pytest.approx(1.0)  # the lap time difference at the line
    pit = progress.clip(trace(70.0, length=1100.0), 30.0)
    assert pit is not None
    kept = progress.on_grid(pit, trace(60.0), length=1100.0)
    assert kept.progress == pytest.approx(pit.length)  # not stretched
    alone = progress.on_grid(current, None)
    assert alone.reference is None and np.isnan(alone.delta).all()


def test_lap_in_progress_against_the_previous_or_best_lap(monkeypatch: pytest.MonkeyPatch) -> None:
    laps = [lap(1, 0, 62), lap(2, 62, 122), lap(3, 122, 183)]
    times = {1: 62.0, 2: 60.0, 3: 61.0}
    monkeypatch.setattr(sessions, "get_laps", lambda y, r, c: laps)
    monkeypatch.setattr(sessions, "get_trace", lambda y, r, c, d, n: trace(times[n]))
    on = progress.lap_in_progress(2025, 1, "R", "VER", 150.0)
    assert (on.lap, on.start, on.reference and on.reference.lap) == (3, 122, 2)
    assert on.trace.time[-1] == pytest.approx(28.0)
    # Best until t: lap 2 (60.0) is done, lap 3 not yet.
    best = progress.lap_in_progress(2025, 1, "R", "VER", 150.0, "best")
    assert best.reference is not None and best.reference.lap == 2
    first = progress.lap_in_progress(2025, 1, "R", "VER", 10.0, "best")
    assert first.reference is None
    with pytest.raises(LookupError):  # after the last lap, not live
        progress.lap_in_progress(2025, 1, "R", "VER", 200.0)


def test_predict_is_the_best_lap_plus_the_delta_on_push_laps_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    laps = [
        lap(2, 40.0, 100.0, lap_time=None, pit_out=True),
        lap(3, 100.0, 160.0),
        lap(4, 160.0, 220.8),
        lap(5, 220.8, 283.3),
    ]
    monkeypatch.setattr(sessions, "get_laps", lambda *_: laps)
    # Lap 4 is 0.8 s down over the whole lap, lap 5 2.5 s (a cool-down).
    traces = {2: trace(60.0), 3: trace(60.0), 4: trace(60.8), 5: trace(62.5)}
    monkeypatch.setattr(progress, "_row_trace", lambda y, r, c, row: traces[row.lap])
    halfway = progress.predict(2025, 1, "Q", "VER", 160.0 + 30.4)
    assert halfway is not None
    assert (halfway.lap, halfway.reference_lap) == (4, 3)
    assert halfway.fraction == pytest.approx(0.5)
    assert halfway.delta == pytest.approx(0.4)
    assert halfway.predicted == pytest.approx(60.4)
    # Too early in the lap, more than the slack down, and on the out-lap (no best yet): nothing.
    assert progress.predict(2025, 1, "Q", "VER", 160.0 + 10.0) is None
    assert progress.predict(2025, 1, "Q", "VER", 220.8 + 50.0) is None
    assert progress.predict(2025, 1, "Q", "VER", 70.0) is None
