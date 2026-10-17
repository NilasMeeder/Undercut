from contextlib import asynccontextmanager
from datetime import date

from fastapi import FastAPI, HTTPException

from app import f1data
from app.schemas import SeasonEvents

FIRST_SEASON = 2018
"""First season with full telemetry in FastF1."""


@asynccontextmanager
async def lifespan(_: FastAPI):
    f1data.init_cache()
    yield


app = FastAPI(title="F1 Pitwall API", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/seasons/{year}/events")
def season_events(year: int) -> SeasonEvents:
    if not FIRST_SEASON <= year <= date.today().year:
        raise HTTPException(404, f"Season {year} not supported (from {FIRST_SEASON})")
    return f1data.get_season_events(year)
