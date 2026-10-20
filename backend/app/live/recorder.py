"""Start and stop the recorder (record.py) from the API.

The recorder runs as its own process in its own session, so restarting the backend (or Ctrl-C on
`make dev`) does not stop a recording. <LIVE_DIR>/recorder.json says which process it is; its
output goes to <LIVE_DIR>/recorder.log. Stopping sends SIGINT, which record.py handles: it closes
the recording and exits.

Automatic (mode "always"): the recorder records every session. <LIVE_DIR>/auto.json remembers that
until it is stopped from here, so the backend starts it again after the Mac restarts (`resume`).
"""

import json
import logging
import os
import re
import signal
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from app import config
from app.live import record

STATE = "recorder.json"
LOG = "recorder.log"
AUTO = "auto.json"
LOG_LINES = 8
RECORDER_PROCESS = re.compile(r"[-]m app\.live\.record( |$)", re.MULTILINE)
"""A recorder's command line; not `app/live/recorder.py` open in an editor (pgrep takes a regex)."""
TOKEN = re.compile(r"eyJ[\w-]+\.[\w-]+\.[\w-]+")
"""A JWT (the F1 TV token): never shown in the log tail, should a library log it."""

Mode = Literal["now", "wait", "always"]
"""now: the session on now; wait: that or the next one; always: every session from now on."""
FLAGS: dict[Mode, list[str]] = {"now": [], "wait": ["--wait"], "always": ["--always"]}

log = logging.getLogger(__name__)


class RecorderBusy(Exception):
    pass


class NotSignedIn(Exception):
    pass


def _state_path() -> Path:
    return config.LIVE_DIR / STATE


def _log_path() -> Path:
    return config.LIVE_DIR / LOG


def _auto_path() -> Path:
    return config.LIVE_DIR / AUTO


def command(mode: Mode) -> list[str]:
    return [sys.executable, "-m", "app.live.record", *FLAGS[mode]]


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    # A finished child stays a zombie until it is reaped: that is not running.
    try:
        done, _ = os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        return _is_recorder(pid)  # not our child: started by an earlier backend
    return done == 0


def _is_recorder(pid: int) -> bool:
    """Whether the process is a recorder: after a reboot its pid can belong to anything else."""
    try:
        found = subprocess.run(  # noqa: S603, S607 (fixed command)
            ["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True, check=False
        )
    except OSError:
        return True  # cannot tell: kill(0) is all we know
    return RECORDER_PROCESS.search(found.stdout) is not None


def running() -> dict[str, Any] | None:
    """The recorder's state ({pid, started, mode}) while its process lives."""
    try:
        state = json.loads(_state_path().read_text())
    except (OSError, ValueError):
        return None
    pid = state.get("pid")
    if isinstance(pid, int) and _alive(pid):
        return state
    _state_path().unlink(missing_ok=True)
    return None


def _elsewhere() -> bool:
    """A recorder started in a terminal (`make live`): two would write into the same recording."""
    try:
        found = subprocess.run(  # noqa: S603, S607 (fixed command)
            ["pgrep", "-f", RECORDER_PROCESS.pattern], capture_output=True, text=True, check=False
        )
    except OSError:
        return False
    return any(pid.strip().isdigit() for pid in found.stdout.splitlines())


def automatic() -> bool:
    """Set to record every session (until stopped from the top bar)."""
    return _auto_path().exists()


def start(mode: Mode) -> dict[str, Any]:
    """Record the session on now, or wait for the next one, or every session (see Mode)."""
    if running() is not None:
        raise RecorderBusy("The recorder is already running")
    if _elsewhere():
        raise RecorderBusy("A recorder already runs in a terminal (make live)")
    if not record.signed_in():
        raise NotSignedIn(
            "Not signed in to F1 TV, or the sign-in expired. In backend/: "
            "uv run python -m fastf1 auth f1tv --authenticate"
        )
    if mode == "now" and record.current_session(datetime.now(UTC)) is None:
        raise LookupError("No session on now")
    config.LIVE_DIR.mkdir(parents=True, exist_ok=True)
    with _log_path().open("a") as output:
        process = subprocess.Popen(  # noqa: S603 (fixed command, no shell)
            command(mode),
            cwd=config.BACKEND_DIR,
            stdin=subprocess.DEVNULL,
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            # FastF1 prints its sign-in prompt: unbuffered, so it shows in the log tail.
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
    state = {"pid": process.pid, "started": datetime.now(UTC).isoformat(), "mode": mode}
    _state_path().write_text(json.dumps(state))
    if mode == "always":
        _auto_path().write_text(json.dumps({"since": state["started"]}))
    return state


def stop() -> None:
    _auto_path().unlink(missing_ok=True)
    state = running()
    if state is not None:
        os.kill(state["pid"], signal.SIGINT)


def resume() -> bool:
    """Automatic, but no recorder (the Mac restarted, the process died): start it again. Quietly
    does nothing while it cannot (signed out, a recorder in a terminal)."""
    if not automatic() or running() is not None:
        return False
    try:
        start("always")
    except (RecorderBusy, NotSignedIn, OSError) as error:
        log.debug("Not resuming the recorder: %s", error)
        return False
    log.info("Resumed the automatic recorder")
    return True


def log_tail(lines: int = LOG_LINES) -> list[str]:
    """The last lines of the recorder's output."""
    try:
        with _log_path().open("rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - 8192))
            text = f.read().decode("utf-8", errors="replace")
    except OSError:
        return []
    return [TOKEN.sub("<token>", line) for line in text.splitlines() if line.strip()][-lines:]
