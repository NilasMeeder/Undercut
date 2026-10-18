"""Start and stop the recorder (record.py) from the API.

The recorder runs as its own process in its own session, so restarting the backend (or Ctrl-C on
`make dev`) does not stop a recording. <LIVE_DIR>/recorder.json says which process it is; its
output goes to <LIVE_DIR>/recorder.log. Stopping sends SIGINT, which record.py handles: it closes
the recording and exits.
"""

import json
import os
import signal
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app import config
from app.live import record

STATE = "recorder.json"
LOG = "recorder.log"
LOG_LINES = 8


class RecorderBusy(Exception):
    pass


class NotSignedIn(Exception):
    pass


def _state_path() -> Path:
    return config.LIVE_DIR / STATE


def _log_path() -> Path:
    return config.LIVE_DIR / LOG


def command(wait: bool) -> list[str]:
    return [sys.executable, "-m", "app.live.record", *(["--wait"] if wait else [])]


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
        return True  # not our child (started by an earlier backend): kill(0) is all we know
    return done == 0


def running() -> dict[str, Any] | None:
    """The recorder's state ({pid, started, wait}) while its process lives."""
    try:
        state = json.loads(_state_path().read_text())
    except (OSError, ValueError):
        return None
    pid = state.get("pid")
    return state if isinstance(pid, int) and _alive(pid) else None


def _elsewhere() -> bool:
    """A recorder started in a terminal (`make live`): two would write into the same recording."""
    try:
        found = subprocess.run(  # noqa: S603, S607 (fixed command)
            ["pgrep", "-f", "app.live.record"], capture_output=True, text=True, check=False
        )
    except OSError:
        return False
    return any(pid.strip().isdigit() for pid in found.stdout.splitlines())


def start(wait: bool) -> dict[str, Any]:
    """Record the session on now; `wait`: or wait for the next one."""
    if running() is not None:
        raise RecorderBusy("The recorder is already running")
    if _elsewhere():
        raise RecorderBusy("A recorder already runs in a terminal (make live)")
    if not record.signed_in():
        raise NotSignedIn(
            "Not signed in to F1 TV. Once, in backend/: "
            "uv run python -m fastf1 auth f1tv --authenticate"
        )
    if not wait and record.current_session(datetime.now(UTC)) is None:
        raise LookupError("No session on now")
    config.LIVE_DIR.mkdir(parents=True, exist_ok=True)
    with _log_path().open("a") as log:
        process = subprocess.Popen(  # noqa: S603 (fixed command, no shell)
            command(wait),
            cwd=config.BACKEND_DIR,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    state = {"pid": process.pid, "started": datetime.now(UTC).isoformat(), "wait": wait}
    _state_path().write_text(json.dumps(state))
    return state


def stop() -> None:
    state = running()
    if state is not None:
        os.kill(state["pid"], signal.SIGINT)


def log_tail(lines: int = LOG_LINES) -> list[str]:
    """The last lines of the recorder's output."""
    try:
        with _log_path().open("rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - 8192))
            text = f.read().decode("utf-8", errors="replace")
    except OSError:
        return []
    return [line for line in text.splitlines() if line.strip()][-lines:]
