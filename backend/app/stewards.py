"""The stewards' side of race control: deleted laps (track limits), black-and-white flags,
incidents from NOTED to a decision, and penalties until served.

Race control writes it all as text in a handful of fixed forms (collected from every 2025 and
2026 race, sprint and qualifying):
  CAR 12 (ANT) TIME 1:37.326 DELETED - TRACK LIMITS AT TURN 4 LAP 16 15:48:48
  CAR 30 (LAW) LAP DELETED - TRACK LIMITS AT TURN 3 LAP 6 16:10:18 (PIT)
  CAR LEC TIME 1:36.518 DELETED - TRACK LIMITS AT TURN 14 (NEXT LAP) (Q1)
  BLACK AND WHITE FLAG FOR CAR 6 (HAD) - TRACK LIMITS
  TURN 4 INCIDENT INVOLVING CARS 30 (LAW) AND 27 (HUL) NOTED (15:53:37)
  FIA STEWARDS: TURN 4 INCIDENT INVOLVING CARS 30 (LAW) AND 27 (HUL) UNDER INVESTIGATION (15:53:37)
  FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 11 (PER) - FAILING TO FOLLOW ...
  FIA STEWARDS: PENALTY SERVED - 5 SECOND TIME PENALTY FOR CAR 31 (OCO) - ...
The messages of one incident name the cars in any order and add the reason later, so they are
matched on the set of cars, the place and the time stamp in brackets when both have them.
"""

import re
from dataclasses import dataclass, field

from app import sessions
from app.generations import session_cache
from app.schemas import (
    BlackAndWhiteFlag,
    DeletedLap,
    Incident,
    IncidentEvent,
    IncidentStatus,
    Penalty,
    PenaltyKind,
    RaceControlMessage,
    Stewarding,
)

_CODE = re.compile(r"\(([A-Z]{3})\)")
_STAMP = re.compile(r"\s*\((\d\d:\d\d:\d\d)\)\s*$")
_PREFIX = re.compile(r"^(?:(?:FIA STEWARDS|UPDATE|CORRECTION):+\s*)+")
_DELETED = re.compile(
    r"^CAR (?:\d+ \(([A-Z]{3})\)|([A-Z]{3}))(?: TIME ([\d:.]+))?(?: LAP)?(?: TIME)? DELETED"
    r"(?: - (.*))?$"
)
_TURN = re.compile(r"AT (TURN \w+|PIT ENTRY|PIT EXIT)")
_LAP = re.compile(r"\bLAP (\d+)\b")
_FLAG = re.compile(r"^BLACK AND WHITE FLAG FOR CARS? (.*?)(?: - (.*))?$")
_STATUSES: list[tuple[str, IncidentStatus]] = [
    ("REVIEWED NO FURTHER INVESTIGATION", "no_investigation"),
    ("NO FURTHER INVESTIGATION", "no_investigation"),
    ("NO FURTHER ACTION", "no_action"),
    ("UNDER INVESTIGATION", "investigating"),
    ("WILL BE INVESTIGATED AFTER THE", "after"),
    ("NOTED", "noted"),
]
_PENALTIES: list[tuple[re.Pattern[str], PenaltyKind]] = [
    (re.compile(r"^(\d+) SECOND STOP/GO PENALTY"), "stop_go"),
    (re.compile(r"^STOP-AND-GO PENALTY"), "stop_go"),
    (re.compile(r"^(\d+) SECOND TIME PENALTY"), "time"),
    (re.compile(r"^DRIVE THROUGH PENALTY"), "drive_through"),
    (re.compile(r"^REPRIMAND"), "reprimand"),
    (re.compile(r"^(\d+) PLACE GRID PENALTY"), "grid"),
    (re.compile(r"^DISQUALIFIED|^DISQUALIFICATION"), "disqualified"),
]
DECIDED: frozenset[IncidentStatus] = frozenset(
    {"no_investigation", "no_action", "penalty", "reprimand"}
)


def _codes(text: str) -> list[str]:
    out: list[str] = []
    for code in _CODE.findall(text):
        if code not in out:
            out.append(code)
    return out


def _split_reason(text: str) -> tuple[str, str]:
    """'... NOTED - CAUSING A COLLISION' → ('... NOTED', 'CAUSING A COLLISION'); also '-REASON'."""
    head, dash, reason = text.partition(" -")
    return head.strip(), reason.lstrip("- ").strip() if dash else ""


def deleted_lap(message: RaceControlMessage) -> DeletedLap | None:
    match = _DELETED.match(message.message.strip())
    if not match:
        return None
    reason = match.group(4) or ""
    turn = _TURN.search(reason)
    lap = _LAP.search(reason)
    return DeletedLap(
        driver=match.group(1) or match.group(2),
        time=message.session_time,
        lap=int(lap.group(1)) if lap else message.lap,
        lap_time=match.group(3),
        turn=turn.group(1) if turn else None,
        track_limits=reason.startswith("TRACK LIMITS"),
        reason=re.sub(r"\s+\d\d:\d\d:\d\d.*$", "", reason),
    )


def black_and_white(message: RaceControlMessage) -> list[BlackAndWhiteFlag]:
    text = _STAMP.sub("", message.message.strip())
    match = _FLAG.match(text)
    if not match:
        return []
    return [
        BlackAndWhiteFlag(driver=code, time=message.session_time, reason=match.group(2) or "")
        for code in _codes(match.group(1))
    ]


@dataclass
class _Open:
    """An incident being followed through its messages."""

    drivers: frozenset[str]
    place: str
    stamp: str | None
    incident: Incident
    penalties: list[Penalty] = field(default_factory=list)


def _penalty(text: str, time: float | None) -> tuple[list[Penalty], str] | None:
    """A decision ('5 SECOND TIME PENALTY FOR CAR 11 (PER) - REASON') as one penalty per car."""
    for pattern, kind in _PENALTIES:
        match = pattern.match(text)
        if not match:
            continue
        head, reason = _split_reason(text)
        seconds = int(match.group(1)) if match.groups() and kind in ("time", "stop_go") else None
        places = int(match.group(1)) if kind == "grid" else None
        drivers = _codes(head) or _codes(text)
        return [
            Penalty(
                driver=code,
                time=time,
                kind=kind,
                seconds=seconds,
                places=places,
                reason=reason,
                text=head.split(" FOR CAR")[0],
                served=None,
            )
            for code in drivers
        ], reason
    return None


def stewarding(messages: list[RaceControlMessage]) -> Stewarding:
    deleted: list[DeletedLap] = []
    flags: list[BlackAndWhiteFlag] = []
    penalties: list[Penalty] = []
    incidents: list[_Open] = []

    def find(drivers: frozenset[str], place: str, stamp: str | None, reason: str) -> _Open | None:
        """The incident these cars, place, stamp and reason belong to (a message may leave out
        the place, the stamp or the reason; when both give one they must agree)."""
        for item in reversed(incidents):
            if item.drivers != drivers:
                continue
            if stamp and item.stamp and stamp != item.stamp:
                continue
            if reason and item.incident.reason and reason != item.incident.reason:
                continue
            if (
                place
                and item.place
                and not (place.endswith(item.place) or item.place.endswith(place))
            ):
                continue
            return item
        return None

    for message in messages:
        raw = message.message.strip()
        time = message.session_time
        if (lap := deleted_lap(message)) is not None:
            deleted.append(lap)
            continue
        if raw.startswith("BLACK AND WHITE FLAG"):
            flags.extend(black_and_white(message))
            continue

        stamp_match = _STAMP.search(raw)
        stamp = stamp_match.group(1) if stamp_match else None
        text = _PREFIX.sub("", _STAMP.sub("", raw)).strip()

        served = text.startswith("PENALTY SERVED")
        if served:
            text = text.removeprefix("PENALTY SERVED").lstrip(" -")
        decided = _penalty(text, time)
        if decided is not None:
            found, reason = decided
            if served:
                for p in found:
                    for earlier in reversed(penalties):
                        if (
                            earlier.driver == p.driver
                            and earlier.served is None
                            and earlier.kind == p.kind
                        ):
                            earlier.served = time
                            break
                continue
            penalties.extend(found)
            for p in found:
                # The open incident with this car: the same reason if both give one, else the
                # last one under investigation (the decision may name another reason: ANT at
                # Monza 2025, investigated for forcing ALB off, penalised for driving erratically).
                open_ = [
                    item
                    for item in incidents
                    if p.driver in item.drivers
                    and item.incident.status not in DECIDED
                    and not (stamp and item.stamp and stamp != item.stamp)
                ]
                same = [i for i in open_ if not (reason and i.incident.reason != reason)]
                looked_at = [i for i in open_ if i.incident.status in ("investigating", "after")]
                target = (same or looked_at or [None])[-1]
                if target is None:
                    target = _Open(
                        drivers=frozenset([p.driver]),
                        place="",
                        stamp=stamp,
                        incident=Incident(
                            drivers=[p.driver], place="", reason=reason, status="noted", events=[]
                        ),
                    )
                    incidents.append(target)
                status: IncidentStatus = "reprimand" if p.kind == "reprimand" else "penalty"
                target.incident.status = status
                target.incident.reason = target.incident.reason or reason
                target.incident.events.append(
                    IncidentEvent(time=time, status=status, text=text, driver=p.driver)
                )
            continue

        if "INCIDENT" not in text:
            continue
        head, reason = _split_reason(text)
        status: IncidentStatus | None = next((s for k, s in _STATUSES if k in head), None)
        if status is None:
            continue
        place = head.split("INCIDENT")[0].strip()
        codes = _codes(head)
        drivers = frozenset(codes)
        item = find(drivers, place, stamp, reason)
        # NOTED again is an update while the incident is only noted, else a new one.
        if item is None or (status == "noted" and item.incident.status != "noted"):
            item = _Open(
                drivers=drivers,
                place=place,
                stamp=stamp,
                incident=Incident(
                    drivers=codes, place=place, reason=reason, status=status, events=[]
                ),
            )
            incidents.append(item)
        item.place = item.place or place
        item.stamp = item.stamp or stamp
        item.incident.place = item.incident.place or place
        item.incident.reason = reason or item.incident.reason
        item.incident.status = status
        item.incident.events.append(IncidentEvent(time=time, status=status, text=text, driver=None))

    return Stewarding(
        deleted=deleted,
        black_and_white=flags,
        incidents=[item.incident for item in incidents],
        penalties=penalties,
    )


@session_cache(maxsize=16)
def get_stewarding(year: int, round_number: int, code: str) -> Stewarding:
    return stewarding(sessions.get_race_control(year, round_number, code))
