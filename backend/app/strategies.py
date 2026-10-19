"""Strategy data per session (see strategy.py for the logic), memoised per cutoff."""

from app import replays, sessions, strategy
from app.generations import session_cache
from app.schemas import (
    Degradation,
    Forecast,
    PitCalculator,
    PitWindow,
    RaceHistory,
    TrackStatus,
)
from app.sources import tracinginsights as ti


@session_cache(maxsize=16)
def get_history(year: int, round_number: int, code: str) -> RaceHistory:
    timeline = replays.get_timeline(year, round_number, code)
    return strategy.history(
        sessions.get_laps(year, round_number, code),
        timeline.kind,
        timeline.total_laps,
        replays.starting_grid(year, round_number, code),
        timeline.track_status,
    )


@session_cache(maxsize=256)
def get_paces(
    year: int, round_number: int, code: str, fuel: float, until: float | None
) -> strategy.Paces:
    timeline = replays.get_timeline(year, round_number, code)
    return strategy.paces(
        sessions.get_laps(year, round_number, code), timeline.total_laps, fuel, until
    )


def get_degradation(
    year: int, round_number: int, code: str, fuel: float, until: float | None
) -> Degradation:
    return strategy.degradation(get_paces(year, round_number, code, fuel, until), until)


def pit_losses(year: int, round_number: int, code: str) -> dict[TrackStatus, float]:
    try:
        circuit = sessions.get_circuit(year, round_number, code)
    except ti.SourceNotAvailable:
        circuit = None
    green = (circuit and circuit.pit_loss) or strategy.DEFAULT_PIT_LOSS
    return {
        "green": green,
        "sc": (circuit and circuit.pit_loss_sc) or green,
        "vsc": (circuit and circuit.pit_loss_vsc) or green,
        "vsc_ending": (circuit and circuit.pit_loss_vsc) or green,
        "red": 0.0,
    }


def get_pit_window(
    year: int,
    round_number: int,
    code: str,
    driver: str,
    fuel: float,
    until: float | None,
    compound: str | None,
) -> PitWindow:
    timeline = replays.get_timeline(year, round_number, code)
    if timeline.kind != "race":
        raise LookupError("The pit window is for races and sprints")
    at = timeline.end if until is None else until
    return strategy.pit_window(
        sessions.get_laps(year, round_number, code),
        get_paces(year, round_number, code, fuel, until),
        driver,
        until,
        pit_losses(year, round_number, code),
        strategy.status_at(timeline.track_status, at),
        compound,
    )


def get_forecast(
    year: int, round_number: int, code: str, fuel: float, until: float | None
) -> Forecast:
    timeline = replays.get_timeline(year, round_number, code)
    if timeline.kind != "race":
        raise LookupError("The forecast is for races and sprints")
    return strategy.forecast(
        sessions.get_laps(year, round_number, code),
        get_paces(year, round_number, code, fuel, until),
        until,
        pit_losses(year, round_number, code)["green"],
    )


def get_pit_calculator(
    year: int, round_number: int, code: str, until: float | None, status: TrackStatus
) -> PitCalculator:
    timeline = replays.get_timeline(year, round_number, code)
    if timeline.kind != "race":
        raise LookupError("The safety car calculator is for races and sprints")
    return strategy.pit_calculator(
        sessions.get_laps(year, round_number, code),
        until,
        pit_losses(year, round_number, code),
        status,
    )
