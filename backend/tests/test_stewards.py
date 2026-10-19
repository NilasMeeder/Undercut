from datetime import UTC, datetime

from app import stewards
from app.schemas import RaceControlMessage


def messages(*texts: str) -> list[RaceControlMessage]:
    """Race control messages a minute apart, as written (Monza 2025 and 2026, Baku 2025)."""
    return [
        RaceControlMessage(
            utc=datetime(2026, 9, 6, 13, 0, tzinfo=UTC),
            session_time=60.0 * (i + 1),
            category="Other",
            message=text,
            flag=None,
            scope=None,
            sector=None,
            driver=None,
            lap=None,
        )
        for i, text in enumerate(texts)
    ]


def test_deleted_laps_in_every_form() -> None:
    result = stewards.stewarding(
        messages(
            "CAR 12 (ANT) TIME 1:37.326 DELETED - TRACK LIMITS AT TURN 4 LAP 16 15:48:48",
            "CAR 30 (LAW) LAP DELETED - TRACK LIMITS AT TURN 3 LAP 6 16:10:18 (PIT)",
            "CAR LEC TIME 1:36.518 DELETED - TRACK LIMITS AT TURN 14 (NEXT LAP) (Q1)",
            "CAR 12 (ANT) LAP DELETED - DOUBLE YELLOW AT TURN 1",
            "CAR 18 (STR) TIME 1:17.977 DELETED - TRACK LIMITS AT PIT ENTRY LAP 22 12:32:14",
        )
    )
    got = [(d.driver, d.lap, d.lap_time, d.turn, d.track_limits) for d in result.deleted]
    assert got == [
        ("ANT", 16, "1:37.326", "TURN 4", True),
        ("LAW", 6, None, "TURN 3", True),
        ("LEC", None, "1:36.518", "TURN 14", True),
        ("ANT", None, None, "TURN 1", False),
        ("STR", 22, "1:17.977", "PIT ENTRY", True),
    ]
    assert result.deleted[0].time == 60.0


def test_black_and_white_flags() -> None:
    result = stewards.stewarding(
        messages(
            "BLACK AND WHITE FLAG FOR CAR 6 (HAD) - TRACK LIMITS",
            "BLACK AND WHITE FLAG FOR CAR 30 (LAW) (15:53:37)",
        )
    )
    assert [(f.driver, f.reason) for f in result.black_and_white] == [
        ("HAD", "TRACK LIMITS"),
        ("LAW", ""),
    ]


def test_an_incident_from_noted_to_a_penalty_served() -> None:
    result = stewards.stewarding(
        messages(
            "TURN 5 INCIDENT INVOLVING CARS 55 (SAI) AND 87 (BEA) NOTED",
            "FIA STEWARDS: TURN 5 INCIDENT INVOLVING CARS 87 (BEA) AND 55 (SAI) UNDER "
            "INVESTIGATION - CAUSING A COLLISION",
            "FIA STEWARDS: 10 SECOND TIME PENALTY FOR CAR 87 (BEA) - CAUSING A COLLISION",
            "FIA STEWARDS: PENALTY SERVED - 10 SECOND TIME PENALTY FOR CAR 87 (BEA) - CAUSING A "
            "COLLISION",
        )
    )
    [incident] = result.incidents
    assert incident.place == "TURN 5" and set(incident.drivers) == {"SAI", "BEA"}
    assert incident.reason == "CAUSING A COLLISION"
    assert [e.status for e in incident.events] == ["noted", "investigating", "penalty"]
    assert incident.status == "penalty"
    [penalty] = result.penalties
    assert (penalty.driver, penalty.kind, penalty.seconds, penalty.served) == (
        "BEA",
        "time",
        10,
        240.0,
    )


def test_a_penalty_with_another_reason_closes_the_investigation() -> None:
    """Monza 2025: ANT investigated for forcing ALB off, penalised for driving erratically."""
    result = stewards.stewarding(
        messages(
            "TURN 3 INCIDENT INVOLVING CARS 12 (ANT) AND 23 (ALB) NOTED - FORCING ANOTHER DRIVER "
            "OFF THE TRACK",
            "FIA STEWARDS: TURN 3 INCIDENT INVOLVING CARS 12 (ANT) AND 23 (ALB) UNDER "
            "INVESTIGATION - FORCING ANOTHER DRIVER OFF THE TRACK",
            "FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 12 (ANT) - DRIVING ERRATICALLY",
        )
    )
    [incident] = result.incidents
    assert incident.status == "penalty"


def test_two_incidents_of_one_car_stay_apart() -> None:
    """Monza 2026: PER noted for a practice start, later for the escape road."""
    result = stewards.stewarding(
        messages(
            "INCIDENT INVOLVING CAR 11 (PER) NOTED - FAILING TO FOLLOW RACE DIRECTORS "
            "INSTRUCTIONS – PRACTICE START INFRINGEMENT (14:20:30)",
            "FIA STEWARDS: INCIDENT INVOLVING CAR 11 (PER) WILL BE INVESTIGATED AFTER THE RACE - "
            "FAILING TO FOLLOW RACE DIRECTORS INSTRUCTIONS – PRACTICE START INFRINGEMENT "
            "(14:20:30)",
            "TURN 1 INCIDENT INVOLVING CAR 11 (PER) NOTED - FAILING TO FOLLOW RACE DIRECTORS "
            "INSTRUCTIONS – ESCAPE ROAD INSTRUCTIONS",
            "FIA STEWARDS: TURN 1 INCIDENT INVOLVING CAR 11 (PER) UNDER INVESTIGATION - FAILING "
            "TO FOLLOW RACE DIRECTORS INSTRUCTIONS – ESCAPE ROAD INSTRUCTIONS (16:09:46)",
            "FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 11 (PER) - FAILING TO FOLLOW RACE "
            "DIRECTORS INSTRUCTIONS – ESCAPE ROAD INSTRUCTIONS",
        )
    )
    start, escape = result.incidents
    assert start.status == "after" and "PRACTICE START" in start.reason
    assert escape.status == "penalty" and escape.place == "TURN 1"
    assert [e.status for e in escape.events] == ["noted", "investigating", "penalty"]


def test_an_update_adds_the_reason() -> None:
    result = stewards.stewarding(
        messages(
            "TURN 1 INCIDENT INVOLVING CARS 1 (NOR), 10 (GAS) AND 43 (COL) NOTED",
            "UPDATE: TURN 1 INCIDENT INVOLVING CARS 1 (NOR), 10 (GAS) AND 43 (COL) NOTED - "
            "CAUSING A COLLISION (16:11:31)",
            "FIA STEWARDS: TURN 1 INCIDENT INVOLVING CARS 1 (NOR), 10 (GAS) AND 43 (COL) UNDER "
            "INVESTIGATION - CAUSING A COLLISION (16:11:31)",
            "FIA STEWARDS: TURN 1 INCIDENT INVOLVING CARS 1 (NOR), 10 (GAS) AND 43 (COL) "
            "REVIEWED NO FURTHER INVESTIGATION - CAUSING A COLLISION (16:11:31)",
        )
    )
    [incident] = result.incidents
    assert incident.drivers == ["NOR", "GAS", "COL"]
    assert incident.reason == "CAUSING A COLLISION"
    assert incident.status == "no_investigation"


def test_other_penalties_and_reprimands() -> None:
    result = stewards.stewarding(
        messages(
            "FIA STEWARDS: DRIVE THROUGH PENALTY FOR CAR 63 (RUS) - LEAVING THE TRACK AND "
            "GAINING AN ADVANTAGE",
            "FIA STEWARDS: STOP-AND-GO PENALTY FOR CAR 43 (COL) - STARTING PROCEDURE INFRINGEMENT",
            "FIA STEWARDS: 10 SECOND STOP/GO PENALTY FOR CAR 87 (BEA) - UNSAFE CONDITION",
            "FIA STEWARDS: REPRIMAND (DRIVING) FOR CAR 55 (SAI) - FAILING TO FOLLOW RACE "
            "DIRECTORS INSTRUCTIONS",
            "FIA STEWARDS: 10 SECOND TIME PENALTY FOR CAR 23 (ALB) (15:04:34)",
        )
    )
    got = [(p.driver, p.kind, p.seconds) for p in result.penalties]
    assert got == [
        ("RUS", "drive_through", None),
        ("COL", "stop_go", None),
        ("BEA", "stop_go", 10),
        ("SAI", "reprimand", None),
        ("ALB", "time", 10),
    ]
    assert [i.status for i in result.incidents][-2:] == ["reprimand", "penalty"]
