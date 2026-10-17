"""Sessions whose data still changes: a live session gets a new generation each time its laps are
converted again. Per-session caches key on the generation, so archive sessions stay cached as
before and a live session is recomputed only when it has new data."""

import threading
from collections.abc import Callable
from functools import lru_cache, wraps
from typing import Any

Key = tuple[int, int, str]

_generations: dict[Key, int] = {}
_guard = threading.Lock()


def generation(year: int, round_number: int, code: str) -> int:
    return _generations.get((year, round_number, code), 0)


def bump(key: Key) -> int:
    with _guard:
        _generations[key] = _generations.get(key, 0) + 1
        return _generations[key]


def session_cache[F: Callable[..., Any]](maxsize: int) -> Callable[[F], F]:
    """lru_cache for functions whose first three arguments are (year, round, code)."""

    def decorate(fn: F) -> F:
        @lru_cache(maxsize=maxsize)
        def cached(_generation: int, *args: Any) -> Any:
            return fn(*args)

        @wraps(fn)
        def wrapper(*args: Any) -> Any:
            return cached(generation(*args[:3]), *args)

        wrapper.cache_clear = cached.cache_clear  # type: ignore[attr-defined]
        return wrapper  # type: ignore[return-value]

    return decorate
