# Roadmap

Van lege template naar pitwall-dashboard. Elke fase levert iets bruikbaars op; niet doorschuiven naar de
volgende fase voordat de vorige echt werkt.

## Wat er nu is

- Fase 0 af (2026-10-17): de Next.js-template is vervangen door `backend/` (FastAPI + FastF1) en
  `frontend/` (Vite + React 19 + Tailwind 4). De kalender per seizoen werkt, met een sessiekiezer.
- Fase 1 grotendeels af (2026-10-17): sessie-, laps-, telemetrie-, circuit- en compare-endpoints op
  TracingInsights-data. Nog open: de OpenF1-fallback en de endpoints voor weer, race control en radio.

## Visie

Een analysetool in pitwall-stijl (referentie: Red Bull RaceX, zie CLAUDE.md "Stijl"), met **veel features
in een rustige basis**. Vier modi op dezelfde onderdelen:

| Modus | Wat | Bron |
|---|---|---|
| **Analyse** | Na de sessie: laps vergelijken, telemetrie, mini-sectoren, bests | archief |
| **Replay** | Een oude sessie afspelen met een tijdslider; alles beweegt mee alsof het live is | archief |
| **Strategie** | Stints, pitverlies-ghosts op de kaart, undercut | archief (later ook live) |
| **Live** | Tijdens een sessie | F1 TV-token + FastF1 live client (OpenF1 live is betaald) |

Kernbeslissingen:
- **Eén sessieklok** voor replay en live: widgets lezen "de toestand op tijd t" en weten niet of t uit het
  archief of uit een live stream komt. Live is daarna "alleen" een andere bron.
- **Docking-indeling (dockview)**: panelen met tabs, splitsen door te slepen, uitklappen naar een tweede scherm.
- **Link-groepen**: elk paneel heeft een kleur; panelen met dezelfde kleur volgen dezelfde driver/lap.
- **Markeringen**: een afstandsbereik of moment markeren met notitie en tags, zichtbaar in alle widgets.
- Volgorde: **basis eerst** (stijl, docking, cursor, link-groepen), dan widgets, dan replay, en live als laatste.

---

## Fase 0 — Fundament

- [x] Monorepo-structuur: `backend/` en `frontend/`
- [x] Frontend naar Vite + React + TS; shadcn `components/ui`, `globals.css` en theme hergebruiken
- [x] Mock auth, login-pagina en template-teksten verwijderen
- [x] npm gekozen, deps bijgewerkt (React 19, Tailwind 4, Vite 8, TS 6); dependabot gegroepeerd per maand
- [ ] Oude dependabot-branches op GitHub sluiten/verwijderen (verouderd door de herstart)
- [x] Backend: `uv init`, Python 3.12, FastAPI, FastF1, ruff, pytest
- [x] FastF1-cache in `backend/.cache/` (in `.gitignore`)
- [x] Vite-proxy `/api` → `localhost:8000`
- [x] Eén script/Makefile om beide tegelijk te starten
- [x] CI aanpassen: ruff + pytest + typecheck + build
- [x] OpenAPI → TS-types (`openapi-typescript`)

**Klaar als:** `make dev` start alles en de frontend toont een lijst events van 2025 uit de API.

## Fase 1 — Data-API (historisch)

- [x] Data-source laag: TracingInsights primair, OpenF1 als fallback, FastF1 later weer aan te sluiten
      (zie CLAUDE.md "Databronnen"; F1 heeft het live-timing-archief sinds 15 okt 2026 achter een login gezet)
- [x] Eigen opslag: ruwe bronbestanden gzipped in `backend/.cache/tracinginsights/`, zodat elk bestand maar één
      keer van internet komt
- [x] `GET /api/seasons/{year}/events`: schema met rondes en sessies
- [x] `GET /api/sessions/{year}/{round}/{session}`: meta, drivers (code, team, kleur)
- [x] `GET .../laps`: alle laps met laptijd, S1/S2/S3, compound, tyre life, stint, flags (deleted, pit, SC)
- [x] `GET .../telemetry?driver=VER&lap=12`: kolom-JSON op afstand (speed, throttle, brake, gear, rpm, drs, x, y)
- [x] `GET .../compare?laps=VER:12,NOR:fastest`: telemetrie van N laps op gemeenschappelijk afstandsgrid
      + delta t.o.v. de eerste + mini-sectoren (`&mini_sectors=25`)
- [x] ~~`GET .../minisectors`~~ zit in `/compare`
- [x] `GET .../circuit`: track-outline, rotatie, bochten
- [x] Sessie-LRU in geheugen + cache op disk
- [ ] Laadstatus: minder urgent, want TracingInsights laadt in <1 s per bestand (eerst in de UI zien of het nodig is)
- [x] Tests voor resampling, delta, mini-sectoren en de API met een nep-archief (27 tests)
- [ ] OpenF1-fallback voor sessies die (nog) niet in TracingInsights staan
- [ ] Weer, race control en team radio endpoints (de data staat al in TracingInsights)

**Klaar als:** je met curl twee snelste kwalificatielaps kunt vergelijken en de delta klopt met de
officiële gap (±0,02 s). ✅ Monza 2025 Q: NOR +0,077, LEC +0,215 (exact officieel).

## Fase 2 — De basis

Alles waar elke latere widget op leunt. Pas klaar als het goed voelt, niet als het er alleen staat.

- [ ] Stijlregels in code: kleur-tokens (achtergrond, lijnen, tekst, semantische kleuren), compacte
      typografie met tabular numerals, paneel-chrome (titelbalk, tabs, tandwiel, sluiten)
- [ ] Docking-shell met dockview: panelen toevoegen, splitsen, tabs, sluiten; layout bewaren in localStorage
- [ ] Widget-registry: id, titel, standaardgrootte, config, link-groep. Nieuwe widget = één bestand + entry
- [ ] Link-groepen: kleurkeuze per paneel, gedeelde selectie (sessie, drivers, laps) per groep
- [ ] Gedeelde cursor (afstand) en zoom (afstandsbereik), buiten React-render om voor snelheid
- [ ] Sessie- en lap-selectie: sessiekiezer in de topbalk, laps kiezen vanuit de laptijdentabel
- [ ] Eerste widgets:
  - [ ] **Laptijdentabel** per driver: sectoren paars/groen/geel, compound, verwijderde/in/out-laps grijs
  - [ ] **Telemetrie-stack** (uPlot): speed, throttle, brake, gear, RPM, DRS, met gedeelde cursor en zoom
  - [ ] **Delta-chart**
  - [ ] **Track map**: outline, bochten, cursorpositie, mini-sectoren gekleurd per snelste lap
- [ ] Preset-layout "Quali-duel" die je met één klik krijgt

**Klaar als:** je een Q3-duel kunt analyseren in een zelf ingedeeld scherm, en de cursor soepel over
alle panelen meeloopt.

## Fase 3 — Analyse-widgets

- [ ] **Bests**: beste S1/S2/S3/lap per driver met % achterstand en **theoretische beste lap**
- [ ] **Run timeline**: kolom per driver, vakje per lap (paars/groen/geel/in pit/out)
- [ ] Mini-sector-tabel en "where is the time": bochten met het grootste verschil
- [ ] Speed traps (I1, I2, finish, trap)
- [ ] Race control-feed en weer-widget (backend-endpoints toevoegen)
- [ ] Overlay van eerdere laps van dezelfde driver
- [ ] Command palette (⌘K) en sneltoetsen (lap vooruit/achteruit, driver wisselen, cursor bevriezen)
- [ ] Meer presets en meerdere dashboard-tabs; layout export/import als JSON

## Fase 4 — Replay

- [ ] Sessieklok (afspelen, pauzeren, snelheid, scrubben) als bron voor alle widgets
- [ ] Backend: toestand op tijd t (posities, gaps, laatste laps, tyres, track status)
- [ ] **Timing tower** op tijd t (gap, interval, sectoren, laatste lap, banden)
- [ ] Track map met alle auto's; **Track Line** (de baan als rechte lijn met auto's erop)
- [ ] Race control en track status volgen de klok

## Fase 5 — Markeringen en opgeslagen views

- [ ] Afstandsbereik of moment markeren met notitie en tags ("lift & coast", "lock-up")
- [ ] Markeringen zichtbaar in charts, track map en Track Line
- [ ] Opgeslagen views: selectie + layout als bladwijzer
- [ ] Opslag in een lokaal SQLite-bestand in `backend/` (geen databaseserver)

## Fase 6 — Strategie en race-analyse

- [ ] Bandenstrategie (stints als balken), tyre degradation met fit, brandstofcorrectie
- [ ] Racetempo, gap-chart, posities per lap
- [ ] Pitverlies-ghosts op de track map ("als je nu pit kom je hier uit")
- [ ] Undercut/overcut-calculator

## Fase 7 — Live

- [ ] F1 TV-token koppelen (zie backlog voor de voorwaarden)
- [ ] FastF1 live client → backend → websocket → dezelfde sessieklok als replay
- [ ] Opnemen tijdens live, zodat de sessie daarna als replay beschikbaar is

## Later / backlog

- [ ] **F1 TV-token als optionele bron** (Nilas heeft F1 TV Pro). Login via `uv run python -m fastf1 auth f1tv --authenticate`
      en de FastF1 Companion-extensie. Voorwaarden:
      - het token **alleen** meesturen naar `livetiming.formula1.com`, nooit naar `livetiming-mirror.fastf1.dev` (FastF1's
        `_api.headers` worden voor beide gebruikt, dus niet daar injecteren maar host-specifiek)
      - het token nooit loggen, nooit naar de frontend, nooit in de repo
      - de extensie na het inloggen weer uitzetten
      - het is alleen nodig voor sessies die nog niet in TracingInsights staan

## Ideeën (later, misschien)

- Remwegen en corner-fases automatisch detecteren uit speed/throttle/brake (braking point, apex, exit)
- Energie-inzet in 2026 inschatten uit speed-traces op straights (er is geen officieel kanaal)
- Team radio afspelen op de tijdlijn (OpenF1 heeft opnames)
- Corner-analyse: min-speed, remwegen, apex-snelheid per bocht vergeleken
- Gear-map / throttle-map op de track
- Long-run vs short-run detectie in vrije trainingen
- Seizoensoverzicht: quali-gaps tussen teammates over een heel jaar
- Dashboard delen als URL (selectie + layout in querystring)
