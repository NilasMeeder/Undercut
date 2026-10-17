# F1 Pitwall

Een F1-analysedashboard in pitwall-stijl, gebouwd op [FastF1](https://docs.fastf1.dev): laps vergelijken,
mini-sectoren, telemetrie-overlays en zelf in te delen widgets.

- `backend/`: Python 3.12, FastAPI en FastF1
- `frontend/`: Vite, React, TypeScript en Tailwind

## Starten

Vereist: [uv](https://docs.astral.sh/uv/) (`brew install uv`) en Node 20+.

```bash
make install
make dev        # API op :8000, dashboard op http://localhost:5173
```

De eerste keer laden van een sessie duurt lang (FastF1 downloadt de data); daarna komt het uit de cache in
`backend/.cache/`.

## Overig

- `make check`: lint, tests, typecheck en build
- `make gen-api`: TypeScript-types opnieuw genereren na een wijziging in de API

Zie `ROADMAP.md` voor de planning en `CLAUDE.md` voor conventies en FastF1-valkuilen.
