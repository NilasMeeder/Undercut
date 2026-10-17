"""User data in a local SQLite file: markers and saved views.

One short-lived connection per call: requests run in FastAPI's thread pool, and SQLite opens in
microseconds. The schema version lives in `PRAGMA user_version`; add a step to MIGRATIONS for a
change and never edit an old one.
"""

import json
import sqlite3
import threading
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from app import config
from app.schemas import Marker, MarkerIn, TagCount, View, ViewIn

MIGRATIONS = [
    """
    CREATE TABLE markers (
        id INTEGER PRIMARY KEY,
        year INTEGER NOT NULL,
        round INTEGER NOT NULL,
        session TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('distance', 'time')),
        start_at REAL NOT NULL,
        end_at REAL,
        driver TEXT,
        lap INTEGER,
        note TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        created TEXT NOT NULL,
        updated TEXT NOT NULL
    );
    CREATE INDEX markers_session ON markers (year, round, session);
    CREATE TABLE views (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        year INTEGER NOT NULL,
        round INTEGER NOT NULL,
        session TEXT NOT NULL,
        state TEXT NOT NULL,
        created TEXT NOT NULL,
        updated TEXT NOT NULL
    );
    """,
]


_migrate_lock = threading.Lock()


class NotFound(LookupError):
    pass


def _path() -> Path:
    # Read at call time, so tests can point it elsewhere.
    return config.DATABASE_PATH


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    try:
        with _migrate_lock:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            for number, script in enumerate(MIGRATIONS[version:], start=version + 1):
                db.executescript(f"BEGIN; {script}; PRAGMA user_version = {number}; COMMIT;")
        with db:  # one transaction per call
            yield db
    finally:
        db.close()


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="microseconds")


def _marker(row: sqlite3.Row) -> Marker:
    return Marker(
        id=row["id"],
        year=row["year"],
        round=row["round"],
        session=row["session"],
        kind=row["kind"],
        start=row["start_at"],
        end=row["end_at"],
        driver=row["driver"],
        lap=row["lap"],
        note=row["note"],
        tags=json.loads(row["tags"]),
        created=row["created"],
        updated=row["updated"],
    )


def list_markers(year: int, round_number: int, session: str) -> list[Marker]:
    with _connect() as db:
        rows = db.execute(
            "SELECT * FROM markers WHERE year = ? AND round = ? AND session = ?"
            " ORDER BY kind, start_at, id",
            (year, round_number, session),
        ).fetchall()
    return [_marker(row) for row in rows]


def _marker_values(marker: MarkerIn) -> tuple:
    return (
        marker.kind,
        marker.start,
        marker.end,
        marker.driver,
        marker.lap,
        marker.note,
        json.dumps(marker.tags),
    )


def add_marker(year: int, round_number: int, session: str, marker: MarkerIn) -> Marker:
    now = _now()
    with _connect() as db:
        cursor = db.execute(
            "INSERT INTO markers (year, round, session, kind, start_at, end_at, driver, lap,"
            " note, tags, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (year, round_number, session, *_marker_values(marker), now, now),
        )
        row = db.execute("SELECT * FROM markers WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _marker(row)


def update_marker(marker_id: int, marker: MarkerIn) -> Marker:
    with _connect() as db:
        cursor = db.execute(
            "UPDATE markers SET kind = ?, start_at = ?, end_at = ?, driver = ?, lap = ?,"
            " note = ?, tags = ?, updated = ? WHERE id = ?",
            (*_marker_values(marker), _now(), marker_id),
        )
        if cursor.rowcount == 0:
            raise NotFound(f"Marker {marker_id} not found")
        row = db.execute("SELECT * FROM markers WHERE id = ?", (marker_id,)).fetchone()
    return _marker(row)


def delete_marker(marker_id: int) -> None:
    with _connect() as db:
        if db.execute("DELETE FROM markers WHERE id = ?", (marker_id,)).rowcount == 0:
            raise NotFound(f"Marker {marker_id} not found")


def tag_counts() -> list[TagCount]:
    """Every tag in use, over all sessions, most used first."""
    with _connect() as db:
        rows = db.execute("SELECT tags FROM markers").fetchall()
    counts = Counter(tag for row in rows for tag in json.loads(row["tags"]))
    return [TagCount(tag=tag, count=n) for tag, n in counts.most_common()]


def _view(row: sqlite3.Row) -> View:
    return View(
        id=row["id"],
        name=row["name"],
        year=row["year"],
        round=row["round"],
        session=row["session"],
        state=json.loads(row["state"]),
        created=row["created"],
        updated=row["updated"],
    )


def list_views() -> list[View]:
    with _connect() as db:
        rows = db.execute("SELECT * FROM views ORDER BY updated DESC, id DESC").fetchall()
    return [_view(row) for row in rows]


def _view_values(view: ViewIn) -> tuple:
    return (view.name, view.year, view.round, view.session, view.state.model_dump_json())


def add_view(view: ViewIn) -> View:
    now = _now()
    with _connect() as db:
        cursor = db.execute(
            "INSERT INTO views (name, year, round, session, state, created, updated)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (*_view_values(view), now, now),
        )
        row = db.execute("SELECT * FROM views WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _view(row)


def update_view(view_id: int, view: ViewIn) -> View:
    with _connect() as db:
        cursor = db.execute(
            "UPDATE views SET name = ?, year = ?, round = ?, session = ?, state = ?, updated = ?"
            " WHERE id = ?",
            (*_view_values(view), _now(), view_id),
        )
        if cursor.rowcount == 0:
            raise NotFound(f"View {view_id} not found")
        row = db.execute("SELECT * FROM views WHERE id = ?", (view_id,)).fetchone()
    return _view(row)


def delete_view(view_id: int) -> None:
    with _connect() as db:
        if db.execute("DELETE FROM views WHERE id = ?", (view_id,)).rowcount == 0:
            raise NotFound(f"View {view_id} not found")
