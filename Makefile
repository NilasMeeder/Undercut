.PHONY: install dev api web test lint check gen-api live

install:
	cd backend && uv sync
	cd frontend && npm install

# Runs API (:8000) and web (:5173) together; Ctrl+C stops both.
dev:
	$(MAKE) -j2 api web

api:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

web:
	cd frontend && npm run dev

test:
	cd backend && uv run pytest

lint:
	cd backend && uv run ruff check . && uv run ruff format --check .
	cd frontend && npm run lint

check: lint test
	cd frontend && npm run typecheck && npm run build

# Records the live timing feed of the session that is on (F1 TV sign-in, see app/live/record.py).
live:
	cd backend && uv run python -m app.live.record

gen-api:
	cd frontend && npm run gen:api
