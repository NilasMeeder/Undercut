from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
CACHE_DIR = BACKEND_DIR / ".cache"
FASTF1_CACHE_DIR = CACHE_DIR / "fastf1"
TRACINGINSIGHTS_CACHE_DIR = CACHE_DIR / "tracinginsights"

TRACINGINSIGHTS_BASE_URL = "https://raw.githubusercontent.com/TracingInsights"
HTTP_TIMEOUT_SECONDS = 30
