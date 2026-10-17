from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
CACHE_DIR = BACKEND_DIR / ".cache"
FASTF1_CACHE_DIR = CACHE_DIR / "fastf1"
