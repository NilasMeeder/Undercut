import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
CACHE_DIR = BACKEND_DIR / ".cache"
FASTF1_CACHE_DIR = CACHE_DIR / "fastf1"
TRACINGINSIGHTS_CACHE_DIR = CACHE_DIR / "tracinginsights"
REPLAY_CACHE_DIR = CACHE_DIR / "replay"
JOLPICA_CACHE_DIR = CACHE_DIR / "jolpica"
DATABASE_PATH = Path(os.environ.get("F1DASH_DB", BACKEND_DIR / "data" / "f1dash.db"))
"""User data (markers, saved views). Not in .cache: that can be thrown away, this cannot."""
LIVE_DIR = Path(os.environ.get("F1DASH_LIVE", BACKEND_DIR / "data" / "live"))
"""Live timing recordings, one folder per session. Kept: once the archive stops publishing a
session, the recording is the only copy."""

TRACINGINSIGHTS_BASE_URL = "https://raw.githubusercontent.com/TracingInsights"
JOLPICA_BASE_URL = "https://api.jolpi.ca/ergast/f1"
HTTP_TIMEOUT_SECONDS = 30
