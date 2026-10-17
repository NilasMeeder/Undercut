"""Record the F1 live timing feed of a session into its live recording.

    uv run python -m app.live.record                # the session on now, or within the hour
    uv run python -m app.live.record 2026 18 FP1

Uses FastF1's live client with its F1 TV sign-in, made once with
`uv run python -m fastf1 auth f1tv --authenticate`. FastF1 sends the token to
livetiming.formula1.com only; f1dash never reads it. Start before the session: the feed sends
changes, so a recording that starts halfway misses the laps before it. Appends, so a restart
continues the same recording. The backend picks the recording up by itself (app/live/service.py).
"""

import argparse
import logging
import signal
import sys
import time
from datetime import UTC, datetime, timedelta

from app import schedule
from app.live import recordings

EARLY = timedelta(hours=1)
"""A session this close to its start counts as the one to record."""
LENGTH = {"R": timedelta(hours=4), "S": timedelta(hours=2)}
"""How long to keep recording after the scheduled start (red flags, the podium); default 2 h."""
DEFAULT_LENGTH = timedelta(hours=2)
SILENCE = 300
"""Seconds without any message (not even a heartbeat) before the client reconnects."""
RETRY_AFTER = 10

log = logging.getLogger("record")


def current_session(now: datetime) -> tuple[int, int, str, datetime] | None:
    """(year, round, code, start) of the session that is on or about to start."""
    for event in schedule.get_season_events(now.year).events:
        for session in event.sessions:
            if session.start_utc is None:
                continue
            start = session.start_utc.to_pydatetime()
            if start - EARLY <= now <= start + LENGTH.get(session.code, DEFAULT_LENGTH):
                return now.year, event.round, session.code, start
    return None


def next_session(now: datetime) -> str:
    upcoming = [
        (s.start_utc.to_pydatetime(), f"{e.name} {s.name}")
        for e in schedule.get_season_events(now.year).events
        for s in e.sessions
        if s.start_utc is not None and s.start_utc.to_pydatetime() > now
    ]
    if not upcoming:
        return "no more sessions this season"
    start, name = min(upcoming)
    return f"next: {name} at {start:%a %d %b %H:%M} UTC"


def signed_in() -> bool:
    from fastf1.internals.f1auth import AUTH_DATA_FILE

    return AUTH_DATA_FILE.exists() and AUTH_DATA_FILE.stat().st_size > 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("year", type=int, nargs="?")
    parser.add_argument("round", type=int, nargs="?")
    parser.add_argument("session", nargs="?", help="FP1 FP2 FP3 SQ S Q R")
    parser.add_argument(
        "--no-auth", action="store_true", help="Try without F1 TV (may give partial data)"
    )
    args = parser.parse_args()
    logging.basicConfig(format="%(asctime)s %(levelname)s %(message)s", level=logging.INFO)
    schedule.init_cache()

    now = datetime.now(UTC)
    if args.session:
        year, round_number, code = args.year, args.round, args.session
        _, info = schedule.resolve_session(year, round_number, code)
        start = info.start_utc.to_pydatetime() if info.start_utc is not None else now
    elif (found := current_session(now)) is not None:
        year, round_number, code, start = found
    else:
        sys.exit(f"No session on now ({next_session(now)}). Name one: 2026 18 FP1")

    if not args.no_auth and not signed_in():
        sys.exit(
            "Not signed in to F1 TV. Run once: uv run python -m fastf1 auth f1tv --authenticate"
        )

    event, session = schedule.resolve_session(year, round_number, code)
    folder = recordings.write_meta(year, round_number, code, event.name, session.name)
    path = folder / recordings.RECORDING
    until = start + LENGTH.get(code, DEFAULT_LENGTH)
    name = f"{event.name} {session.name}"
    log.info("Recording %s into %s until %s UTC", name, path, f"{until:%H:%M}")
    record(str(path), until, args.no_auth)


def record(path: str, until: datetime, no_auth: bool) -> None:
    from fastf1.livetiming.client import SignalRClient

    stopping = False

    def stop(signum, frame):  # noqa: ARG001 (signal handler signature)
        nonlocal stopping
        stopping = True
        raise KeyboardInterrupt

    signal.signal(signal.SIGINT, stop)
    while not stopping and datetime.now(UTC) < until:
        try:
            # Append: a reconnect continues the recording (F1 resends its state first).
            SignalRClient(path, filemode="a", timeout=SILENCE, no_auth=no_auth).start()
        except KeyboardInterrupt:
            break
        except Exception:
            log.exception("The live client stopped")
        if not stopping and datetime.now(UTC) < until:
            log.info("Reconnecting in %d s", RETRY_AFTER)
            time.sleep(RETRY_AFTER)
    log.info("Stopped recording")


if __name__ == "__main__":
    main()
