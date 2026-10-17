"""The F1 live timing feed in the file format of FastF1's recorder (fastf1.livetiming.client).

One message per line. A streamed update is the Python repr of `[topic, data, utc]`; the state the
server sends right after subscribing is `[topic, json_string, '']` (no time). `.z` topics carry
base64 raw-deflated JSON. Recordings are kept as written, so a parsing bug can be fixed afterwards
and the session converted again.
"""

import ast
import base64
import json
import zlib
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Message:
    topic: str
    data: Any
    utc: datetime | None
    """None for the initial state (sent once, right after subscribing)."""


def parse_line(line: str) -> Message | None:
    """One recorded line; None for anything that is not a message (the recorder logs nothing else,
    but a crash can leave half a line)."""
    line = line.strip()
    if not line.startswith("["):
        return None
    try:
        value = ast.literal_eval(line)
    except (ValueError, SyntaxError, MemoryError, RecursionError):
        return None
    if not isinstance(value, list) or len(value) < 2 or not isinstance(value[0], str):
        return None
    topic, data = value[0], value[1]
    stamp = value[2] if len(value) > 2 else ""
    if isinstance(data, str) and not topic.endswith(".z"):
        try:
            data = json.loads(data)
        except json.JSONDecodeError:
            return None
    return Message(topic, data, parse_utc(stamp) if stamp else None)


def parse_utc(value: str) -> datetime | None:
    """'2025-09-07T13:03:34.806Z' (F1 sends 0 to 7 fraction digits) -> aware UTC."""
    try:
        head, _, fraction = value.rstrip("Z").partition(".")
        stamp = datetime.fromisoformat(head).replace(tzinfo=UTC)
        if fraction:
            stamp = stamp.replace(microsecond=int(fraction[:6].ljust(6, "0")))
        return stamp
    except ValueError:
        return None


def format_utc(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def update_line(topic: str, data: Any, utc: datetime) -> str:
    return str([topic, data, format_utc(utc)])


def state_line(topic: str, data: Any) -> str:
    return str([topic, json.dumps(data), ""])


def inflate(text: str) -> Any:
    raw = zlib.decompress(base64.b64decode(text.strip('"')), -zlib.MAX_WBITS)
    return json.loads(raw.decode("utf-8-sig"))


def deflate(value: Any) -> str:
    packer = zlib.compressobj(6, zlib.DEFLATED, -zlib.MAX_WBITS)
    raw = packer.compress(json.dumps(value, separators=(",", ":")).encode()) + packer.flush()
    return base64.b64encode(raw).decode()


class Tail:
    """Reads a recording that is still being written: every read() returns the complete lines
    added since the last one."""

    def __init__(self, path: Path):
        self.path = path
        self.offset = 0
        self._partial = b""
        self.restarted = False
        """Set by read() when the file was started over (shorter than what was read)."""

    def read(self) -> list[Message]:
        self.restarted = False
        try:
            with self.path.open("rb") as f:
                if f.seek(0, 2) < self.offset:
                    self.offset, self._partial, self.restarted = 0, b"", True
                f.seek(self.offset)
                chunk = f.read()
        except FileNotFoundError:
            return []
        self.offset += len(chunk)
        lines = (self._partial + chunk).split(b"\n")
        self._partial = lines.pop()
        messages = []
        for line in lines:
            message = parse_line(line.decode("utf-8", errors="replace"))
            if message is not None:
                messages.append(message)
        return messages
