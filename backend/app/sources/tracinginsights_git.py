"""Bulk downloads from the TracingInsights season repos through a git partial clone.

A race has ~1000 telemetry files. Over raw.githubusercontent.com that is ~1000 requests (~45 s); git
fetches exactly the blobs of one session folder in a single request (~15 s).

The clone is bare, shallow and blobless: it only holds the file tree of the latest commit (~6 MB
per season). The blobs fetched for a session are handed to the caller (who caches them) and their
pack is deleted again, so nothing is stored twice. In a partial clone that is safe: git treats the
objects as missing again and would refetch them from the remote if it ever needed them.
"""

import os
import re
import shutil
import subprocess
import threading
from collections.abc import Callable
from pathlib import Path

from app.config import TRACINGINSIGHTS_CACHE_DIR

REPO_URL = "https://github.com/TracingInsights/{year}.git"
TIMEOUT_SECONDS = 600
DOWNLOAD_SHARE = 0.5

# Never prompt for credentials (the repos are public), never repack behind our back: deleting the
# fetched pack relies on the clone's own pack staying separate.
_ENV = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
_CONFIG = ["-c", "gc.auto=0", "-c", "maintenance.auto=false"]

_PROGRESS = re.compile(rb"Receiving objects:\s+(\d+)%")


class GitError(Exception):
    """git is missing, the network failed, or the repo does not look as expected."""


_locks: dict[int, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(year: int) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(year, threading.Lock())


def _repo(year: int) -> Path:
    return TRACINGINSIGHTS_CACHE_DIR / "_git" / f"{year}.git"


def _git(repo: Path | None, *args: str, stdin: bytes | None = None) -> bytes:
    command = ["git", *_CONFIG, *(["-C", str(repo)] if repo else []), *args]
    result = subprocess.run(
        command, input=stdin, capture_output=True, env=_ENV, timeout=TIMEOUT_SECONDS
    )
    if result.returncode != 0:
        message = result.stderr.decode(errors="replace").strip()
        raise GitError(f"git {args[0]} failed: {message[-300:]}")
    return result.stdout


def _clone(year: int) -> Path:
    repo = _repo(year)
    if not repo.exists():
        tmp = repo.with_name(f"{repo.name}.tmp")
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.parent.mkdir(parents=True, exist_ok=True)
        url = REPO_URL.format(year=year)
        _git(None, "clone", "--bare", "--depth=1", "--filter=blob:none", "-q", url, str(tmp))
        tmp.rename(repo)
    return repo


def _refresh(repo: Path) -> None:
    """Move to the latest commit, for sessions added to the archive after the clone."""
    branch = _git(repo, "symbolic-ref", "HEAD").decode().strip()
    _git(repo, "fetch", "--depth=1", "--filter=blob:none", "-q", "origin", f"+{branch}:{branch}")


def _tree(repo: Path, folder: str) -> dict[str, str]:
    """Blob id per file path (relative to `folder`) in the latest commit."""
    out = _git(repo, "ls-tree", "-r", "-z", "HEAD", "--", f"{folder}/")
    blobs = {}
    for entry in filter(None, out.split(b"\0")):
        meta, _, path = entry.partition(b"\t")
        _, kind, oid = meta.split()
        if kind == b"blob":
            blobs[path.decode()[len(folder) + 1 :]] = oid.decode()
    return blobs


def _packs(repo: Path) -> set[Path]:
    return set((repo / "objects" / "pack").glob("*.pack"))


def _fetch(repo: Path, oids: list[str], progress: Callable[[float], None]) -> None:
    """Fetch these blobs in one pack, reporting the fraction received."""
    command = [
        "git",
        *_CONFIG,
        "-c",
        "fetch.negotiationAlgorithm=noop",
        "-C",
        str(repo),
        "fetch",
        "--progress",
        "--no-tags",
        "--no-write-fetch-head",
        "--filter=blob:none",
        "--stdin",
        "origin",
    ]
    with subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        env=_ENV,
    ) as proc:
        assert proc.stdin and proc.stderr
        proc.stdin.write("\n".join(oids).encode())
        proc.stdin.close()
        tail = b""
        # Progress lines end in \r; read in chunks and parse the last complete line of each.
        while chunk := proc.stderr.read1(4096):
            tail = (tail + chunk)[-4096:]
            if match := list(_PROGRESS.finditer(tail)):
                progress(int(match[-1].group(1)) / 100)
        if proc.wait(timeout=TIMEOUT_SECONDS) != 0:
            raise GitError(f"git fetch failed: {tail.decode(errors='replace').strip()[-300:]}")


def _read(repo: Path, oids: list[str]) -> dict[str, bytes]:
    out = _git(repo, "cat-file", "--batch", stdin="\n".join(oids).encode() + b"\n")
    blobs = {}
    pos = 0
    while pos < len(out):
        end = out.index(b"\n", pos)
        header = out[pos:end].split()
        if len(header) != 3:
            raise GitError(f"blob {header[0].decode()} missing after fetch")
        size = int(header[2])
        blobs[header[0].decode()] = out[end + 1 : end + 1 + size]
        pos = end + 2 + size
    return blobs


def prefetch(
    year: int,
    folder: str,
    files: list[str],
    progress: Callable[[float], None],
    on_file: Callable[[str, bytes], None],
) -> set[str]:
    """Fetch `files` (relative to `folder`, e.g. 'VER/12_tel.json') and pass each to `on_file`.

    Returns the files that are not in the archive.
    """
    if shutil.which("git") is None:
        raise GitError("git is not installed")
    with _lock_for(year):
        repo = _clone(year)
        tree = _tree(repo, folder)
        if not tree:
            _refresh(repo)
            tree = _tree(repo, folder)
        wanted = {f: tree[f] for f in files if f in tree}
        before = _packs(repo)
        try:
            oids = sorted(set(wanted.values()))
            # Receiving is about half the work, decompressing and caching the other half.
            _fetch(repo, oids, lambda fraction: progress(fraction * DOWNLOAD_SHARE))
            # cat-file in batches keeps memory to ~25 MB of JSON at a time.
            by_file = list(wanted.items())
            for start in range(0, len(by_file), 200):
                batch = by_file[start : start + 200]
                blobs = _read(repo, sorted({oid for _, oid in batch}))
                for file, oid in batch:
                    on_file(file, blobs[oid])
                done = start + len(batch)
                progress(DOWNLOAD_SHARE + (1 - DOWNLOAD_SHARE) * done / len(by_file))
        finally:
            for pack in _packs(repo) - before:
                for sibling in pack.parent.glob(f"{pack.stem}.*"):
                    sibling.unlink(missing_ok=True)
        progress(1.0)
        return set(files) - set(wanted)
