"""Record the F1 live timing feed of a session into its live recording.

    uv run python -m app.live.record                # the session on now, or within the hour
    uv run python -m app.live.record --wait         # that, or wait for the next one
    uv run python -m app.live.record --always       # every session, one after the other
    uv run python -m app.live.record 2026 18 FP1

Uses FastF1's live client with its F1 TV sign-in, made once with
`uv run python -m fastf1 auth f1tv --authenticate`. FastF1 sends the token to
livetiming.formula1.com only; f1dash reads it only to see whether it has expired. Start before
the session: the feed sends changes, so a recording that starts halfway misses the laps before
it. Appends, so a restart continues the same recording. The backend picks the recording up by
itself (app/live/service.py). On a Mac it keeps the computer awake while it records, and from
AWAKE_BEFORE before a session it waits for (caffeinate).
"""

import argparse
import logging
import os
import signal
import subprocess
import sys
import time
from datetime import UTC, datetime, timedelta

import jwt

from app import schedule
from app.live import recorder, recordings

EARLY = timedelta(hours=1)
"""A session this close to its start counts as the one to record."""
LENGTH = {"R": timedelta(hours=4), "S": timedelta(hours=2)}
"""How long to keep recording after the scheduled start (red flags, the podium); default 2 h."""
DEFAULT_LENGTH = timedelta(hours=2)
EXTRA_TOPICS = ["PitStopSeries", "PitLaneTimeCollection", "ChampionshipPrediction"]
"""Topics FastF1's client does not subscribe to: pit stop times (stood still), and F1's own
championship prediction. F1 ignores a topic it does not have."""
SILENCE = 300
"""Seconds without any message (not even a heartbeat) before the client reconnects."""
RETRY_AFTER = 10
WAIT_STEP = 600
"""Longest sleep while waiting for a session (seconds)."""
AWAKE_BEFORE = timedelta(hours=2)
"""Keep the Mac awake from this long before a session it waits for: asleep, it would miss it."""
RETRY_WAITING = 60
"""--always: seconds before trying again when waiting failed (no network after a wake)."""
NO_CALENDAR = 6 * 3600
"""--always: seconds before looking again when the calendar has no sessions left."""

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


class Awake:
    """Keeps the Mac from sleeping (caffeinate, ends with this process) until released. Elsewhere
    it does nothing. A closed MacBook on battery sleeps anyway."""

    def __init__(self) -> None:
        self._process: subprocess.Popen | None = None

    def hold(self) -> None:
        if self._process is not None and self._process.poll() is None:
            return
        try:
            self._process = subprocess.Popen(  # noqa: S603, S607 (fixed command)
                ["caffeinate", "-i", "-s", "-w", str(os.getpid())],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            log.info("Keeping the Mac awake")
        except OSError:
            self._process = None

    def release(self) -> None:
        if self._process is not None:
            self._process.terminate()
            self._process = None


def wait_for_session(awake: Awake, forever: bool = False) -> tuple[int, int, str, datetime]:
    """Sleep until the next session is close enough to record (EARLY before its start).
    `forever`: with no sessions left, look again later (next year's calendar) instead of exiting."""
    while True:
        now = datetime.now(UTC)
        if (found := current_session(now)) is not None:
            return found
        upcoming = upcoming_session(now)
        if upcoming is None:
            if not forever:
                sys.exit("No more sessions to wait for")
            log.info("No sessions left in the calendar: looking again in %d h", NO_CALENDAR // 3600)
            awake.release()
            time.sleep(NO_CALENDAR)
            continue
        # In steps, so a laptop that slept does not oversleep.
        wake = upcoming[3] - EARLY
        if wake - now <= AWAKE_BEFORE:
            awake.hold()
        else:
            awake.release()
        log.info("Waiting until %s UTC (%s)", f"{wake:%a %d %b %H:%M}", next_session(now))
        time.sleep(min(max((wake - now).total_seconds(), 1.0), WAIT_STEP))


def _token() -> str:
    from fastf1.internals.f1auth import AUTH_DATA_FILE

    try:
        return AUTH_DATA_FILE.read_text().strip()
    except OSError:
        return ""


def signed_in(now: datetime | None = None) -> bool:
    """A sign-in that has not expired. An expired one would make FastF1 wait for a new sign-in in
    the browser, and a recorder started from the top bar would hang there unseen."""
    token = _token()
    return token != "" and not token_expired(token, now or datetime.now(UTC))


def sign_in_expires() -> datetime | None:
    """When the F1 TV sign-in expires (None: not signed in, or no expiry in the token)."""
    token = _token()
    return token_expiry(token) if token else None


def token_expiry(token: str) -> datetime | None:
    """The token's `exp`. Only read locally (FastF1 checks the signature)."""
    try:
        expires = jwt.decode(token, options={"verify_signature": False}).get("exp")
    except jwt.PyJWTError:
        return None
    return datetime.fromtimestamp(expires, UTC) if isinstance(expires, int | float) else None


def token_expired(token: str, now: datetime) -> bool:
    """Whether the token's `exp` has passed; an unreadable token counts as expired."""
    try:
        jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError:
        return True
    expires = token_expiry(token)
    return expires is not None and expires <= now


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
    parser.add_argument(
        "--always", action="store_true", help="Record every session, waiting for each next one"
    )
    args = parser.parse_args()
    # Started in the background SIGINT is ignored, and stopping (the top bar) sends SIGINT.
    signal.signal(signal.SIGINT, signal.default_int_handler)
    logging.basicConfig(format="%(asctime)s %(levelname)s %(message)s", level=logging.INFO)
    schedule.init_cache()

    now = datetime.now(UTC)
    if args.session:
        year, round_number, code = args.year, args.round, args.session
        _, info = schedule.resolve_session(year, round_number, code)
        start = info.start_utc.to_pydatetime() if info.start_utc is not None else now
    elif (found := current_session(now)) is None and not (args.wait or args.always):
        sys.exit(f"No session on now ({next_session(now)}). Name one: 2026 18 FP1")

    other = recorder.running()
    if other is not None and other["pid"] != os.getpid():
        sys.exit("The recorder already runs (started from the top bar): stop it there first")
    if not args.no_auth and not signed_in():
        sys.exit(
            "Not signed in to F1 TV, or the sign-in expired. Run: "
            "uv run python -m fastf1 auth f1tv --authenticate"
        )
    awake = Awake()
    if args.always and not args.session:
        record_always(awake, args.no_auth)
        return
    if not args.session:
        try:
            found = found or wait_for_session(awake)
        except KeyboardInterrupt:
            log.info("Stopped waiting")
            return
        year, round_number, code, start = found
    record_session(year, round_number, code, start, args.no_auth, awake)


def record_always(awake: Awake, no_auth: bool) -> None:
    """Every session: wait for it, record it, wait for the next. Waiting can fail (no network
    right after the Mac wakes): then it tries again; a recorder that exits misses the weekend."""
    while True:
        try:
            year, round_number, code, start = wait_for_session(awake, forever=True)
        except KeyboardInterrupt:
            log.info("Stopped waiting")
            return
        except Exception:
            log.exception("Waiting failed, trying again in %d s", RETRY_WAITING)
            try:
                time.sleep(RETRY_WAITING)
            except KeyboardInterrupt:
                return
            continue
        if not signed_in() and not no_auth:
            # Without a valid sign-in FastF1 would wait for a browser login nobody sees.
            log.error(
                "The F1 TV sign-in expired. Run: uv run python -m fastf1 auth f1tv --authenticate"
            )
            return
        try:
            if record_session(year, round_number, code, start, no_auth, awake):
                return
        except Exception:
            log.exception("Recording failed")
            time.sleep(RETRY_AFTER)


def record_session(
    year: int, round_number: int, code: str, start: datetime, no_auth: bool, awake: Awake
) -> bool:
    """Record one session until its end; True if stopped (SIGINT) before that."""
    event, session = schedule.resolve_session(year, round_number, code)
    folder = recordings.write_meta(year, round_number, code, event.name, session.name)
    path = folder / recordings.RECORDING
    until = start + LENGTH.get(code, DEFAULT_LENGTH)
    name = f"{event.name} {session.name}"
    log.info("Recording %s into %s until %s UTC", name, path, f"{until:%H:%M}")
    awake.hold()
    try:
        return record(str(path), until, no_auth)
    finally:
        awake.release()


def record(path: str, until: datetime, no_auth: bool) -> bool:
    """Record into `path` until `until`; True if stopped (SIGINT) before that."""
    from fastf1.livetiming.client import SignalRClient

    stopping = False

    def stop(signum, frame):  # noqa: ARG001 (signal handler signature)
        nonlocal stopping
        stopping = True
        raise KeyboardInterrupt

    previous = signal.signal(signal.SIGINT, stop)
    while not stopping and datetime.now(UTC) < until:
        try:
            # Append: a reconnect continues the recording (F1 resends its state first).
            client = SignalRClient(path, filemode="a", timeout=SILENCE, no_auth=no_auth)
            client.topics = [*client.topics, *EXTRA_TOPICS]
            client.start()
        except KeyboardInterrupt:
            break
        except Exception:
            log.exception("The live client stopped")
        if not stopping and datetime.now(UTC) < until:
            log.info("Reconnecting in %d s", RETRY_AFTER)
            try:
                time.sleep(RETRY_AFTER)
            except KeyboardInterrupt:
                break
    signal.signal(signal.SIGINT, previous)
    log.info("Stopped recording")
    return stopping


if __name__ == "__main__":
    main()
