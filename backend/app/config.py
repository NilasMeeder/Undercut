import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
CACHE_DIR = BACKEND_DIR / ".cache"
FASTF1_CACHE_DIR = CACHE_DIR / "fastf1"
TRACINGINSIGHTS_CACHE_DIR = CACHE_DIR / "tracinginsights"
REPLAY_CACHE_DIR = CACHE_DIR / "replay"
DATABASE_PATH = Path(os.environ.get("F1DASH_DB", BACKEND_DIR / "data" / "f1dash.db"))
"""User data (markers, saved views). Not in .cache: that can be thrown away, this cannot."""

TRACINGINSIGHTS_BASE_URL = "https://raw.githubusercontent.com/TracingInsights"
HTTP_TIMEOUT_SECONDS = 30
