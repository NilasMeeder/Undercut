# Roadmap

Van lege template naar pitwall-dashboard. Elke fase levert iets bruikbaars op; niet doorschuiven naar de
volgende fase voordat de vorige echt werkt.

## Wat er nu is

- Fase 0 af (2026-10-17): de Next.js-template is vervangen door `backend/` (FastAPI + FastF1) en
  `frontend/` (Vite + React 19 + Tailwind 4). De kalender per seizoen werkt, met een sessiekiezer.

## Wat er ontbreekt (grote lijnen)

1. Een backend die FastF1-data laadt, cachet en omzet naar compacte JSON.
2. Rekenlogica: resampling op afstand, delta-tijd, mini-sectoren, stint/tyre-analyse.
3. Snelle telemetrie-charts met gesynchroniseerde cursor.
4. Selectie-UX: sessie kiezen → drivers → laps, snel en met toetsenbord.
5. Widget-systeem met versleepbare/resizebare layout, opslaan en presets.
6. (Later) live/replay.

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

- [ ] Data-source laag: FastF1 primair, OpenF1 als fallback, met dezelfde interne vorm (zie CLAUDE.md
      "Databronnen"). Eerst testen of FastF1 vanaf een thuisverbinding werkt.
- [ ] Eigen opslag van verwerkte sessies (parquet), zodat een sessie maar één keer van een externe bron
      komt. Dat beschermt tegen blokkades en rate limits.
- [x] `GET /api/seasons/{year}/events`: schema met rondes en sessies
- [ ] `GET /api/sessions/{year}/{event}/{session}`: meta, drivers (code, team, kleur), weer-samenvatting
- [ ] `GET .../laps`: alle laps met laptijd, S1/S2/S3, compound, tyre life, stint, flags (deleted, pit, SC)
- [ ] `GET .../telemetry?driver=VER&lap=12`: kolom-JSON op afstand (speed, throttle, brake, gear, rpm, drs, x, y)
- [ ] `GET .../compare?laps=VER:12,NOR:fastest`: telemetrie van N laps op gemeenschappelijk afstandsgrid
      + delta t.o.v. de eerste
- [ ] `GET .../minisectors?laps=...&n=25`: tijd per mini-sector per lap + winnaar per sector
- [ ] `GET .../circuit`: track-outline, rotatie, bochten
- [ ] Sessie-LRU in geheugen + verwerkte cache op disk
- [ ] Laadstatus: endpoint of SSE dat meldt "bezig met laden" (eerste load duurt lang)
- [ ] Tests voor resampling, delta, mini-sectoren (met een kleine fixture-sessie)

**Klaar als:** je met curl twee snelste kwalificatielaps kunt vergelijken en de delta klopt met de
officiële gap (±0,02 s).

## Fase 2 — Kern-analyse UI (vaste layout)

Nog geen widget-systeem, gewoon een vaste pagina die werkt.

- [ ] Sessiekiezer: jaar → event → sessie (zoekbaar, laatst gebruikte onthouden)
- [ ] Driver/lap-selectie: drivers aanvinken, per driver "fastest" of een specifieke lap
- [ ] **Laptijdtabel**: alle laps per driver, sectoren paars/groen/geel, compound-badge, gefilterde laps grijs
- [ ] **Telemetrie-stack** (uPlot): speed, throttle, brake, gear, RPM en DRS onder elkaar op afstand,
      één gedeelde cursor
- [ ] **Delta-chart** boven de stack
- [ ] **Track map**: outline, cursorpositie, bochtnummers
- [ ] **Mini-sector map**: track gekleurd per snelste driver
- [ ] Zoom op afstandsbereik (bv. één bocht), synchroon over alle charts
- [ ] Overlay vorige laps van dezelfde driver (lap X vs lap Y)

**Klaar als:** je een Q3-duel kunt analyseren zonder FastF1 in een notebook te openen.

## Fase 3 — Widget-dashboard

- [ ] Widget registry + react-grid-layout
- [ ] Alle widgets uit fase 2 omzetten naar losse widgets
- [ ] Widget-config per instantie (bv. welke kanalen, aantal mini-sectoren, welke drivers)
- [ ] Widgets die "globale selectie volgen" of een eigen vaste selectie hebben
- [ ] Layouts opslaan/laden (localStorage), export/import als JSON
- [ ] Presets: *Quali-analyse*, *Race pace*, *Strategie*
- [ ] Meerdere dashboard-tabs
- [ ] Sneltoetsen: lap vooruit/achteruit, driver wisselen, cursor bevriezen

## Fase 4 — Race-analyse widgets

- [ ] Racetempo: laptijden per lap per driver (outliers/SC weggefilterd), rolling average
- [ ] Bandenstrategie: stints als horizontale balken met compound-kleuren
- [ ] Tyre degradation: laptijd vs tyre life per compound, met fit
- [ ] Gap-chart: gap tot leider/tot een gekozen driver per lap
- [ ] Posities per lap
- [ ] Pitstops: tijd in de pitlane, gewonnen/verloren posities
- [ ] Race control messages + track status-tijdlijn (SC/VSC/rood als banden over charts)
- [ ] Weer-widget: lucht/baantemperatuur, regen, wind over de sessie
- [ ] Speed trap / top speeds-vergelijking

## Fase 5 — Replay & live (optioneel, groot)

- [ ] Replay-modus: tijdslider, alle auto's op de track map, timing tower op dat moment
- [ ] Live data onderzoeken: FastF1 `livetiming` (opnemen en terugspelen) of OpenF1. Eerst checken wat
      er op dat moment nog gratis en zonder login kan; daar is de laatste jaren veel aan veranderd.
- [ ] Websocket van backend naar frontend voor live updates

## Ideeën (later, misschien)

- Lap-simulatie / ideal lap: de som van de beste mini-sectoren per driver, "theoretische beste lap"
- Remwegen en corner-fases automatisch detecteren uit speed/throttle/brake (braking point, apex, exit)
- Energie-inzet in 2026 inschatten uit speed-traces op straights (er is geen officieel kanaal)
- Undercut/overcut-calculator op basis van pitlane-verlies en tyre deg
- Racetempo-model: brandstofcorrectie (~0,03 s/lap per kg) zodat stints eerlijk te vergelijken zijn
- Team radio afspelen op de tijdlijn (OpenF1 heeft opnames)
- Command palette (⌘K): "VER vs NOR Q3 fastest" typen en het dashboard staat klaar
- Corner-analyse: min-speed, remwegen, apex-snelheid per bocht vergeleken
- "Where is the time": automatisch de 3 bochten met het grootste verschil markeren
- Gear-map / throttle-map op de track
- Long-run vs short-run detectie in vrije trainingen
- Seizoensoverzicht: quali-gaps tussen teammates over een heel jaar
- Dashboard delen als URL (selectie + layout in querystring)
