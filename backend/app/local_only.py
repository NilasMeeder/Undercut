"""Keep the API to this machine's own pages.

The API has no login: it trusts whoever can reach it, and it only listens on 127.0.0.1. But a
browser lets any website send requests there. Two ways in, both closed here:
- DNS rebinding: a site points its own name at 127.0.0.1 and reads the answers. The Host header
  still carries that name, so only localhost names pass.
- Simple requests: a POST without a body (start the recorder, prepare a replay) needs no
  preflight, so a page elsewhere can send it blind. The Origin header says where it came from;
  a changing request from a page that is not on localhost is refused.
"""

from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any
from urllib.parse import urlsplit

Scope = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[MutableMapping[str, Any]]]
Send = Callable[[MutableMapping[str, Any]], Awaitable[None]]
App = Callable[[Scope, Receive, Send], Awaitable[None]]

HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def hostname(value: str) -> str | None:
    """The host name of a Host header ("localhost:8000", "[::1]:8000") or an Origin URL."""
    try:
        return urlsplit(value if "//" in value else f"//{value}").hostname
    except ValueError:
        return None


def allowed(method: str, host: str | None, origin: str | None) -> bool:
    if host is None or hostname(host) not in HOSTS:
        return False
    # No Origin: not a cross-site browser request (curl, the Vite proxy for some requests).
    return method in SAFE_METHODS or origin is None or hostname(origin) in HOSTS


class LocalOnly:
    def __init__(self, app: App) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            headers = {
                key.decode("latin-1"): value.decode("latin-1") for key, value in scope["headers"]
            }
            if not allowed(scope["method"], headers.get("host"), headers.get("origin")):
                await send(
                    {
                        "type": "http.response.start",
                        "status": 403,
                        "headers": [(b"content-type", b"text/plain")],
                    }
                )
                await send({"type": "http.response.body", "body": b"Only for pages on localhost"})
                return
        await self.app(scope, receive, send)
