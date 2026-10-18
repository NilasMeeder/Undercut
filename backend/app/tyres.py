"""Tyre sets over a race weekend. The data has no set numbers, only per lap the compound, whether
the set was new when the stint began (FreshTyre) and its age in laps (TyreLife, which carries
over to the next stint or session on the same set). A new stint on a used set is the earlier set
of that compound whose age it continues: the one with the highest age below the stint's first."""

from dataclasses import dataclass, field

from app import schedule, sessions
from app.generations import session_cache
from app.schemas import DriverTyres, Lap, TyreSet, TyreUse, TyreWeekend


@dataclass(frozen=True)
class Stint:
    session: str
    stint: int
    compound: str
    fresh: bool
    first_life: int
    last_life: int
    laps: int


@dataclass
class Set:
    compound: str
    new_in: str | None
    """The session it was first used in new; None when it came used from before the data."""
    uses: list[Stint] = field(default_factory=list)

    @property
    def life(self) -> int:
        return self.uses[-1].last_life


def stints(code: str, laps: list[Lap]) -> dict[str, list[Stint]]:
    """Per driver the stints of one session, in order, with compound and tyre age."""
    by_stint: dict[tuple[str, int], list[Lap]] = {}
    for lap in sorted(laps, key=lambda row: (row.driver, row.lap)):
        if lap.stint is None or lap.compound is None or lap.tyre_life is None:
            continue
        by_stint.setdefault((lap.driver, lap.stint), []).append(lap)
    out: dict[str, list[Stint]] = {}
    for (driver, number), rows in sorted(by_stint.items()):
        lives = [row.tyre_life for row in rows if row.tyre_life is not None]
        out.setdefault(driver, []).append(
            Stint(
                session=code,
                stint=number,
                compound=rows[0].compound or "UNKNOWN",
                fresh=rows[0].fresh_tyre is True,
                first_life=min(lives),
                last_life=max(lives),
                laps=len(rows),
            )
        )
    return out


def chain(order: list[Stint]) -> list[Set]:
    """The sets one driver used, from his stints in time order."""
    sets: list[Set] = []
    for stint in order:
        found = None
        if not stint.fresh:
            earlier = [
                s for s in sets if s.compound == stint.compound and s.life < stint.first_life
            ]
            found = max(earlier, key=lambda s: s.life, default=None)
        if found is None:
            found = Set(stint.compound, stint.session if stint.fresh else None)
            sets.append(found)
        found.uses.append(stint)
    return sets


def _use(stint: Stint) -> TyreUse:
    return TyreUse(
        session=stint.session, laps=stint.laps, first=stint.first_life, last=stint.last_life
    )


@session_cache(maxsize=8)
def weekend(year: int, round_number: int, code: str) -> TyreWeekend:
    """Every driver's sets over the weekend's sessions up to and including `code`."""
    event, _ = schedule.resolve_session(year, round_number, code)
    codes = [s.code for s in event.sessions]
    included = codes[: codes.index(code) + 1]
    per_driver: dict[str, list[Stint]] = {}
    found, missing = [], []
    for session in included:
        try:
            laps = sessions.get_laps(year, round_number, session)
        except Exception:  # noqa: BLE001 - a session without data is listed as missing
            missing.append(session)
            continue
        found.append(session)
        for driver, rows in stints(session, laps).items():
            per_driver.setdefault(driver, []).extend(rows)
    drivers = [
        DriverTyres(
            driver=driver,
            sets=[
                TyreSet(
                    compound=s.compound,
                    new_in=s.new_in,
                    life=s.life,
                    laps=sum(u.laps for u in s.uses),
                    last_session=s.uses[-1].session,
                    uses=[
                        TyreUse(
                            session=u.session, laps=u.laps, first=u.first_life, last=u.last_life
                        )
                        for u in s.uses
                    ],
                )
                for s in chain(order)
            ],
        )
        for driver, order in sorted(per_driver.items())
    ]
    return TyreWeekend(sessions=found, missing=missing, drivers=drivers)
