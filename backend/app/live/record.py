"""Record the F1 live timing feed of a session into its live recording.

    uv run python -m app.live.record                # the session on now, or within the hour
    uv run python -m app.live.record --wait         # that, or wait for the next one
    uv run python -m app.live.record 2026 18 FP1

Uses FastF1's live client with its F1 TV sign-in, made once with
`uv run python -m fastf1 auth f1tv --authenticate`. FastF1 sends the token to
livetiming.formula1.com only; f1dash never reads it. Start before the session: the feed sends
changes, so a recording that starts halfway misses the laps before it. Appends, so a restart
continues the same recording. The backend picks the recording up by itself (app/live/service.py).
"""

import argparse
import logging
import os
import signal
import sys
import time
from datetime import UTC, datetime, timedelta

from app import schedule
from app.live import recorder, recordings

EARLY = timedelta(hours=1)
"""A session this close to its start counts as the one to record."""
LENGTH = {"R": timedelta(hours=4), "S": timedelta(hours=2)}
"""How long to keep recording after the scheduled start (red flags, the podium); default 2 h."""
DEFAULT_LENGTH = timedelta(hours=2)
SILENCE = 300
"""Seconds without any message (not even a heartbeat) before the client reconnects."""
RETRY_AFTER = 10
WAIT_STEP = 600
"""Longest sleep while waiting for a session (seconds)."""

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


def upcoming_session(now: datetime) -> tuple[int, int, str, datetime] | None:
    """(year, round, code, start) of the next session to start after `now` (this year or next)."""
    for year in (now.year, now.year + 1):
        upcoming = [
            (s.start_utc.to_pydatetime(), e.round, s.code)
            for e in _events(year)
            for s in e.sessions
            if s.start_utc is not None and s.start_utc.to_pydatetime() > now
        ]
        if upcoming:
            start, round_number, code = min(upcoming)
            return year, round_number, code, start
    return None


def _events(year: int):  # -> list[EventInfo]
    try:
        return schedule.get_season_events(year).events
    except Exception:  # next year's calendar may not be out yet
        return []


def next_session(now: datetime) -> str:
    found = upcoming_session(now)
    if found is None:
        return "no more sessions this season"
    year, round_number, code, start = found
    event, session = schedule.resolve_session(year, round_number, code)
    return f"next: {event.name} {session.name} at {start:%a %d %b %H:%M} UTC"


def wait_for_session() -> tuple[int, int, str, datetime]:
    """Sleep until the next session is close enough to record (EARLY before its start)."""
    while True:
        now = datetime.now(UTC)
        if (found := current_session(now)) is not None:
            return found
        upcoming = upcoming_session(now)
        if upcoming is None:
            sys.exit("No more sessions to wait for")
        # In steps, so a laptop that slept does not oversleep.
        wake = upcoming[3] - EARLY
        log.info("Waiting until %s UTC (%s)", f"{wake:%a %d %b %H:%M}", next_session(now))
        time.sleep(min(max((wake - now).total_seconds(), 1.0), WAIT_STEP))


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
    parser.add_argument(
        "--wait", action="store_true", help="No session on now: wait for the next one"
    )
    args = parser.parse_args()
    logging.basicConfig(format="%(asctime)s %(levelname)s %(message)s", level=logging.INFO)
    schedule.init_cache()

    now = datetime.now(UTC)
    if args.session:
        year, round_number, code = args.year, args.round, args.session
        _, info = schedule.resolve_session(year, round_number, code)
        start = info.start_utc.to_pydatetime() if info.start_utc is not None else now
    elif (found := current_session(now)) is None and not args.wait:
        sys.exit(f"No session on now ({next_session(now)}). Name one: 2026 18 FP1")

    other = recorder.running()
    if other is not None and other["pid"] != os.getpid():
        sys.exit("The recorder already runs (started from the top bar): stop it there first")
    if not args.no_auth and not signed_in():
        sys.exit(
            "Not signed in to F1 TV. Run once: uv run python -m fastf1 auth f1tv --authenticate"
        )
    if not args.session:
        try:
            found = found or wait_for_session()
        except KeyboardInterrupt:
            log.info("Stopped waiting")
            return
        year, round_number, code, start = found

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
