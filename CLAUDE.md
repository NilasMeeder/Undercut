# F1 Pitwall Dashboard

Hobbyproject: een geavanceerd F1-analysedashboard in de stijl van een pitwall. Laptijden vergelijken,
mini-sectoren, telemetrie (speed/throttle/brake/gear/RPM/DRS) van meerdere drivers of laps over elkaar,
en een zelf in te delen dashboard met widgets.

**Prioriteit: snelheid en bruikbaarheid > uiterlijk.** Het moet eruitzien als echte pitwall-software,
niet als een AI-dashboard. Zie "Stijl" hieronder. Veel features mag, maar op een goede basis.

Vier modi op dezelfde onderdelen: analyse, replay, strategie en live. Zie `ROADMAP.md` "Visie".

Zie `ROADMAP.md` voor fases en status. Werk de checkboxes daar bij als iets af is.

## Huidige status

Fase 0 t/m 6 zijn af: een docking-dashboard (dockview) met twintig widgets (Laps, Telemetry, Delta,
Live lap, Track map, Bests, Speed traps, Run timeline, Corners, Clock, Race control, Weather, Timing
tower, Track line, Markers, Stints, Gaps, Positions, Race pace, Pit window), link-groepen, gedeelde cursor/zoom,
instellingen (tandwiel) en uitleg (i) per paneel, ⌘K-palette met sneltoetsen, dashboard-tabs met
presets, replay (een sessieklok onderin waar de tower, de kaart met alle auto's, de Track line en race
control op lopen, zie "Replay"), markeringen met notitie en tags plus opgeslagen views als bladwijzer
(zie "Markeringen en views"), en strategie: stints, degradatie, gaps, posities, undercut en
pitverlies-ghosts, allemaal op de sessieklok (zie "Strategie"). Fase 7 (live) is gebouwd en getest met
de simulator; de echte test is de eerste sessie met Nilas' F1 TV-login (zie "Live" en ROADMAP.md).
Live telemetrie volgen: FOLLOW per link-groep (`l`) en de widget Live lap (zie "Live lap en Follow").
Verder in fase 7: Clock als digitale klok (lokale tijd op het circuit of sessieklok), late start
(een opname die halverwege begint klopt vanaf de instap), de tower live uit TimingData met F1's
mini-sectoren, en REC in de topbalk om de recorder te starten of te laten wachten op de volgende
sessie (zie "Live").

**Visueel testen:** draai voor een test een eigen backend met een wegwerp-database, zodat je geen
markeringen of views in Nilas' echte `backend/data/f1dash.db` zet:
`F1DASH_DB=<scratchpad>/test.db uv run uvicorn app.main:app --port 8001` en
`F1DASH_API=http://localhost:8001 npx vite --port 5174 --strictPort` (is 5174 bezet, neem 5175; de bron-cache in `.cache/` wordt
gedeeld, dus niets wordt opnieuw gedownload). De Chrome-extensie is vaak niet verbonden. Gebruik dan
headless Chrome via `playwright-core` in je scratchpad (`chromium.launch({ channel: 'chrome' })`). Zet eerst
`localStorage['f1dash-selection'] = {"state":{"year":2025,"round":16,"session":"Q"},"version":0}`.
Monza 2025 Q is de vaste testsessie: VER 1:18.792, NOR +0.077, LEC +0.215.
Valkuilen bij het headless testen:
- `useDefaultSelection` zet bij een lege selectie al VER + NOR in de blauwe groep; klik ze dus niet aan
  (dan zet je ze weer uit). Wacht op een `canvas`.
- Widgets toevoegen via het +-menu: match de titel exact (`getByText(title, { exact: true })`).
  `hasText` matcht ook beschrijvingen ("Corners" zit in de beschrijving van Track map).
- `getByRole('tab')` vindt ook de dockview-tabs; de dashboard-tabs zitten in `[aria-label=Dashboards]`.
- Popout: `ctx.waitForEvent('page')` rond de klik op "Open in a separate window".
- Replay: zet ook `localStorage['f1dash-dashboards'] =
  {"state":{"tabs":[{"id":"t1","name":"Replay","layout":null,"preset":"replay"}],"active":"t1"},"version":0}`
  en wacht op de tekst `LAP` (race) of `Q1`/`Q2`/`Q3`. De klok staat bij het laden op het einde; klik
  op de scrubber (`footer [title^="Click or drag to move the session clock"]`) op een fractie van de
  breedte, of druk op Space. Monza 2025 R (ronde 16) is de vaste replay-sessie: op lap 17 leidt VER
  met +4.366 voor NOR, en de eindstand op de baan is VER, NOR +19.207, PIA +21.351.
  Lees de `boundingBox` van de scrubber pas als "Positions ready" er staat: de voortgangsbalk ernaast
  verandert de breedte. `LAP 12/53` staat ook in de tower: gebruik `getByText(/^LAP/).first()`.
- Strategie: preset `strategy` (zelfde `f1dash-dashboards`-truc, `preset: 'strategy'`), wacht op `LAP`.
  Controlegetallen Monza R (fuel 0,03): VER stopt L37 (verlies 25,5 s), NOR L46 (28,7 s, de trage
  stop), PIA L45 (23,2 s); VER medium +0,038 s/lap, NOR medium +0,029. Op lap 36 zegt het pit window
  voor NOR: pit nu = P4, undercut op VER +0,56 / +1,46 / +2,39 op een gap van 5,46 s; de ghost
  "NOR PIT P4" op de kaart zegt hetzelfde. Q en FP: gaps/positions/pit window tonen "for races".
- Live: draai de backend met ook `F1DASH_LIVE=<scratchpad>/live` (opnames los van Nilas' echte
  `backend/data/live/`) en speel een sessie af met de simulator:
  `F1DASH_LIVE=<scratchpad>/live uv run python -m app.live.simulate 2025 16 R --speed 1 --start 6400`
  (`--start` in archief-sessietijd: alles daarvoor gaat er meteen in, 6400 = rond lap 36; `--speed 0`
  = alles in één keer, dan is de sessie na 2 minuten "opgenomen"). Opnieuw starten overschrijft de
  opname; de backend ziet dat zelf. Zelfde preset `replay`; wacht op `LAP`, de LIVE-knop in de
  klokbalk heeft dan de title `Following the live feed`. Live-sessietijd loopt vanaf het geplande
  begin (Monza R: 13:00 UTC), niet vanaf het archief-t0: dezelfde lap heeft live een ander t.
- Markeringen: `keyboard.down('Shift')` en dan slepen of klikken in een `.u-over` (de grootste is de
  speed-chart); de editor heeft het placeholder `What happens here` en Enter slaat op. Een view openen
  via een link: `page.goto` naar alleen een andere hash herlaadt de pagina niet (dat vangt de
  `hashchange`-listener af); voor een echte herstart een querystring toevoegen (`/?x=1#view=1`).

## Architectuur

```
backend/    Python 3.12 + FastAPI + FastF1   → JSON API op :8000
frontend/   Vite + React + TypeScript        → SPA op :5173, praat met /api (proxy)
```

- **Backend** doet al het zware werk: FastF1 laden, cachen, telemetrie resamplen, delta's en
  mini-sectoren berekenen. De frontend rekent zo min mogelijk.
- **Frontend** is een puur client-side dashboard. Geen SSR nodig (canvas-charts, localStorage-layouts).
- Geen auth, geen databaseserver. Opslag is embedded: bronbestanden gzipped in `backend/.cache/`
  (weggooibaar), gebruikersdata (markeringen, views) in SQLite in `backend/data/f1dash.db` (niet
  weggooien, niet in git; `F1DASH_DB` wijst een ander bestand aan).
- **Draait als gewone processen op macOS (uv + npm), zonder Docker of containers.** Een Dockerfile voor
  de thuis-desktop mag later als optie, maar mag nooit nodig zijn om lokaal te ontwikkelen.

### Stack-keuzes

| Onderdeel | Keuze | Waarom |
|---|---|---|
| Data | FastF1 | Laps, sectoren, car data, positie, weer, race control, tyre stints (2018+) |
| API | FastAPI + Pydantic | Snel, typed, automatische OpenAPI → TS-types genereren |
| Python tooling | uv | Systeem-Python (3.9) is te oud; FastF1 vereist ≥3.10 |
| Frontend | Vite + React + TS | Snelle HMR, geen SSR-gedoe met canvas/localStorage |
| Styling | Tailwind + shadcn/ui | Bestaande `components/ui` hergebruiken |
| Telemetrie-charts | uPlot | Tienduizenden punten zonder haperen, cursor-sync tussen charts |
| Overige charts | uPlot of ECharts | Alleen ECharts als uPlot echt tekortschiet (bv. strategie-balken) |
| Docking | dockview (`dockview-react`) | Panelen met tabs, splitsen door te slepen, uitklappen naar een tweede venster, layout als JSON |
| Server state | TanStack Query | Caching/dedup van API-calls per sessie |
| Client state | Zustand | Sessie, link-groepen (selectie per groep), cursor/zoom, sessieklok |

## Commando's

```bash
make install         # uv sync + npm install
make dev             # API op :8000 en web op :5173 (Vite proxyt /api)
make check           # ruff, pytest, oxlint, tsc, build: draai dit voor je iets "af" noemt
make gen-api         # na elke wijziging in backend-schemas: regenereert frontend/src/api/schema.d.ts
make live            # neemt de live-feed op van de sessie die nu bezig is (F1 TV-login, zie "Live")

# los
cd backend && uv run pytest
cd backend && uv run ruff check . && uv run ruff format .
cd frontend && npm run typecheck && npm run lint && npm run format
```

## Structuur

```
backend/app/main.py        FastAPI-app en routes (dun: valideren, data-laag aanroepen, afronden)
backend/app/schedule.py    seizoensschema via FastF1 + resolve_session(year, round, code)
backend/app/sources/       één module per databron; tracinginsights.py haalt ruwe JSON op en cachet die gzipped,
                           tracinginsights_git.py haalt een hele sessie in één keer op (bulk, zie "Replay"),
                           jolpica.py de startgrid
backend/app/sessions.py    bronnen → schemas, met lru_caches (laps, drivers, circuit, LapTrace per lap)
backend/app/analysis.py    pure numpy-rekenlogica: resample, compare (delta), mini_sectors
backend/app/replay.py      pure replay-logica: positiespoor (build_track), timing tower op t (timing_state),
                           track status uit race control
backend/app/replays.py     replay per sessie: tijdlijn, timing-index, de bouwjob van het positiespoor (.npz)
backend/app/progress.py    de lap die bezig is op t (replay: afgeknipt, live: uit het geheugen) en de live delta
backend/app/strategy.py    pure strategie-logica: history (gaps, posities, stints, stops), degradatie-fits,
                           pit window (rejoin, undercut/overcut); strategies.py: per sessie + lru_cache
backend/app/live/          live (fase 7): feed.py (opnameformaat, tail), record.py (recorder), simulate.py (archief →
                           feed), convert.py (FastF1 → archiefvorm), service.py (opnames volgen en omzetten),
                           track.py (positiespoor dat groeit), telemetry.py (telemetrie per lap), tower.py
                           (F1's tower uit TimingData over die uit de laps), recorder.py (recorder als
                           proces starten/stoppen vanuit de API), recordings.py
backend/app/generations.py versie per sessie; session_cache = lru_cache die op die versie sleutelt (live verloopt)
backend/app/store.py       gebruikersdata in SQLite: markeringen en views (migraties via PRAGMA user_version)
backend/app/schemas.py     Pydantic response-modellen (bron voor de TS-types)
backend/scripts/           export_openapi.py (gebruikt door gen-api)
frontend/src/api/          client.ts (fetch + type-aliassen), queries.ts (TanStack hooks), markers.ts en views.ts
                           (gebruikersdata: queries + mutaties), live.ts (SSE: klokrand, verversen, posities
                           aanplakken), schema.d.ts (gegenereerd)
frontend/src/store/        selection.ts (sessie), groups.ts (link-groepen + laps per groep), cursor.ts (cursor/zoom-bus,
                           bevriezen), dashboards.ts (tabs met elk een layout), clock.ts (sessieklok),
                           markerEditor.ts (de open markering-editor: markNew, editMarker), live.ts (live-status)
frontend/src/dashboard/    Dashboard.tsx (dockview, tabs, header-acties), layout.ts (presets, opslaan/herstellen),
                           HeaderMenu.tsx (dropdown in de titelbalk), PanelMenus.tsx (uitleg en instellingen)
frontend/src/widgets/      één map per widget: widget.ts (definitie, help, defaults, settings, lazy component)
                           + de component; registry.ts somt ze op; types.ts (defineWidget, resolveConfig);
                           useGroupComparison.ts deelt de compare-data; hooks.ts (useClockDraw, useElementSize);
                           useStrategy.ts (history + klok + cutoff, drivers van een groep, driverkleuren)
frontend/src/components/   chart/UPlotChart.tsx (uPlot gekoppeld aan cursor/zoom), chart/LapChart.tsx (uPlot over laps:
                           SC-banden, klok-lijn, labels, readout), data/bits.tsx (badges, swatches),
                           data/SegmentDisplay.tsx (7-segmentcijfers in SVG)
frontend/src/lib/          colors.ts (spiegel van de CSS-tokens), format.ts, timing.ts (paars/groen, bests, attempts,
                           lijnstijlen), laps.ts (lap/driver stappen), insights.ts (zinnen voor Corners), table.ts,
                           replay.ts (auto op t interpoleren, klokformaat, pit-ghosts), markers.ts (labels, plaats
                           als tekst), strategy.ts (cutoff, volgorde op t, lap-as, SC-banden)
frontend/src/features/     topbalk: session/ (SessionPicker, GroupBar, useDefaultSelection), commands/ (⌘K en
                           sneltoetsen), dashboards/ (tabs, Layout-menu met presets en export/import),
                           clock/ (ClockBar onderin, useSessionClock), markers/ (MarkerEditor, actions:
                           springen en markeren), views/ (ViewsMenu, openen/opslaan, #view=-links),
                           live/ (LiveBadge: een live sessie die niet open staat, RecorderMenu: REC),
                           session/FollowLatest
                           (laps van volgende groepen meeschuiven)
```

Tooling-notities: frontend gebruikt oxlint (niet ESLint) en TypeScript 6. `openapi-typescript` ondersteunt
TS 6 nog niet als peer, daarom draait `gen:api` het via `npx` in plaats van als devDependency.

## Databronnen (getest 2026-10-17)

**Sinds 14–15 okt 2026 zit het hele archief van livetiming.formula1.com achter een login (401).** Dat geldt
ook voor thuisverbindingen; datacenter-IP's kregen al sinds ~mei 2026 een 403. Alleen met een F1 TV
`Authorization: Bearer`-token lukt het (FastF1 issue #978, de maintainer kijkt ernaar). FastF1 kan dus
zonder cache geen laps of telemetrie meer laden. Het schema werkt nog wel, dat komt uit een andere bron.

| Bron | Wat | Status |
|---|---|---|
| **Live-opnames** (`backend/data/live/`) | Sessies opgenomen met `make live`, omgezet naar de vorm hieronder | Gaat vóór TracingInsights (zie "Live"). Vanaf Austin 2026 de enige bron. |
| **TracingInsights** (`github.com/TracingInsights/<jaar>`) | 2018–2026, per sessie: `session_laptimes.json`, `drivers.json`, `corners.json`, `rcm.json`, `weather.json`, `team_radio.json`, en per driver `<DRV>/<lap>_tel.json` | **Primaire bron.** Gratis (Apache 2.0) via `raw.githubusercontent.com`. Gemaakt met FastF1, al kolom-georiënteerd met distance, x/y/z, acc_x/y/z en DriverAhead. Nieuwe sessies na 15 okt 2026 komen er mogelijk niet meer bij. Zie hun `DATA_REFERENCE.md`. |
| **OpenF1** (`api.openf1.org/v1`) | Laps, sectoren, car_data, location, stints, pit, weer, race control, team radio | **Fallback** voor sessies die nog niet in TracingInsights staan. Historisch (2023+) gratis zonder key, max 3 req/s en 30 req/min. Live alleen betaald. |
| FastF1 | Schema (`get_event_schedule`); de live-feed (signalrcore, F1 TV-login) en het omzetten ervan | Schema, en live (zie "Live"). Het archief alleen met een F1 TV-token. |
| Jolpica (Ergast-opvolger, `api.jolpi.ca/ergast/f1`) | Uitslagen, standen, startgrid | Gratis. Nu gebruikt voor de startgrid in replay. |

Gevolg: de backend krijgt een **data-source laag** (`app/sources/`) waarin elke bron dezelfde interne vorm
levert. Volgorde: lokale opslag → TracingInsights → OpenF1. Een opgehaalde sessie wordt meteen lokaal
opgeslagen (`backend/.cache/`), zodat elke sessie maar één keer van internet komt.
Let op: FastF1's `session.load()` gooit **geen** exception als de bron faalt. Het logt alleen warnings,
en daarna geeft `session.laps` een `DataNotLoadedError`.

**2026-regels:** DRS bestaat niet meer (active aero + overtake mode). In de 2026-data is `drs` leeg
(`null`), en er is geen kanaal voor wingstand of energie-inzet. Het DRS-kanaal dus alleen tonen als er data is.

## Replay (fase 4)

**Eén tijdas:** sessietijd in seconden (zie "Tijdassen"). De sessieklok (`store/clock.ts`) is globaal en
loopt buiten React om, net als de cursorbus: `clock.subscribe` tikt elke frame tijdens het afspelen
(kaarten tekenen imperatief via `useClockDraw`), `useClockTime(ms)` re-rendert tabellen gedoseerd.
Bij het laden van een sessie staat de klok op het **einde**, zodat widgets die de klok volgen (race
control) in analyse-modus gewoon alles tonen. Live (fase 7) wordt een andere bron voor dezelfde klok.

Drie soorten replay-data, bewust gescheiden naar kosten:
- **Tijdlijn** (`/timeline`): bereik, t0 (UTC), laps van de leider, Q-delen, track status. Klein, direct.
- **Timing tower** (`/timing?t=`): uit de lapdata alleen, dus direct beschikbaar. Volgorde en gaps in een
  race per timingpunt (S1, S2, finish: 3 per lap), zoals de officiële tower; Q/FP op beste lap per Q-deel.
  Paars/groen zoals het op dat moment was. Elk antwoord heeft `valid_from`/`valid_until` (vorige en
  volgende gebeurtenis), dus de frontend vraagt alleen opnieuw als de klok dat venster verlaat (max 10/s).
  Rekenwerk in `replay.timing_state`, ~1 ms. Valkuilen in de data: een DNS-driver heeft een spooklap
  zonder tijden (eindtijd gekopieerd van de leider): `replay.driven()` filtert die. Q-out-laps lopen vanaf
  het einde van de vorige in-lap, inclusief garagetijd: de garage is pit-in tot pit-out (> 60 s).
  TracingInsights heeft geen startgrid; die komt van Jolpica (`sources/jolpica.py`, race en sprint,
  gecachet in `.cache/jolpica/`). Vóór de eerste S1-passage staat de grid (pitstraat-start achteraan);
  zonder Jolpica de volgorde van die eerste passage.
- **Positiespoor** (`/positions`): x, y en lap-voortgang van elke auto op een raster van 4 Hz over de
  hele sessie. Daarvoor is de telemetrie van **elke lap** nodig (Monza R: 973 bestanden, ~116 MB JSON).
  Bulk-download via een **git partial clone** per seizoen (`--bare --depth=1 --filter=blob:none`, ~6 MB
  boom, eenmalig ~8 s), daarna de blobs van één sessiemap in **één `git fetch`** (race ~4 s) en
  `cat-file --batch`; de bestanden gaan de gewone gzip-cache in en het opgehaalde pack wordt weer
  verwijderd. Valt terug op HTTP met 8 tegelijk (~45 s voor een race) als git ontbreekt of faalt.
  Daarna bouwt `replay.build_track` het spoor (~1,5 s) en `replays.py` slaat het op als
  `.cache/replay/<jaar>/<event>/<sessie>/track-v1.npz` (verhoog `TRACK_VERSION` bij een andere opbouw).
  De respons is ~6 MB JSON, één keer gegzipt (~2 MB) en zo gecachet. Voortgang:
  `POST .../positions/prepare` start de job, `GET .../positions/status` pollt (`progress` 0–1, `phase`).
  Een replay-widget die mount start de voorbereiding zelf; de klokbalk toont de voortgang.
  Lap-voortgang: lap 1 (vanaf de grid of pit-exit) en out-laps worden vanaf de finishlijn terug gemeten,
  andere laps als `distance / lapafstand`. Garagetijd en gaten > 2 s zijn `null` (auto niet getoond).
- **Gele sectoren**: `corners.json` heeft marshal-sectoren met hun startafstand (`Circuit.marshal_sectors`,
  elk tot de volgende; de laatste loopt over de finish). `replay.sector_flag_periods` maakt uit race
  control (scope `Sector`) perioden per sector tot CLEAR, of tot een baanbrede GREEN/CLEAR/RED/CHEQUERED
  (`SessionTimeline.sector_flags`). De kaart (met alle auto's) en de Track line kleuren die stukken geel.
- **Sessieklok** (`SessionTimeline.clock`, widget Clock): punten (t, resterend, loopt). Live F1's eigen
  `ExtrapolatedClock` (`converted/clock.json`, `convert.clock_columns`: updates bevatten alleen wat
  verandert, dus samenvoegen met de toestand ervoor). Archief: nagerekend in `replay.session_clock`
  (Q1 18, Q2 15, Q3 12 min, SQ 12/10/8, vanaf de eerste auto uit de pit; training 60 min vanaf de
  eerste lap; stil tijdens rode vlaggen), dus een paar seconden onzeker. Races: geen klok, de widget
  toont racetijd en lap. De simulator stuurt de nagerekende klok als `ExtrapolatedClock`.
  De widget is een digitale klok (`components/data/SegmentDisplay.tsx`, 7 segmenten in SVG): groot
  de lokale tijd op het circuit (`t0_utc` + t + `SessionInfo.utc_offset`, de offset per sessie uit
  FastF1's `SessionXDate`) of de sessieklok, het andere klein ernaast; knop LOCAL/SESSION (`mode`).

## Live (fase 7)

**Live = een archief dat groeit.** Een opname van de live-feed wordt elke paar seconden omgezet naar
dezelfde bestanden als TracingInsights; alle bestaande endpoints en widgets werken daardoor zonder
wijziging op een sessie die nog loopt, en na afloop is de opname gewoon een replay. Dat telt, want
TracingInsights is sinds 13 okt 2026 niet meer bijgewerkt (Singapore 2026 is de laatste).

- **Opnemen** (`app/live/record.py`, `make live`): FastF1's `SignalRClient` (signalrcore), met FastF1's
  eigen F1 TV-login (`uv run python -m fastf1 auth f1tv --authenticate`, één keer; het token gaat alleen
  naar livetiming.formula1.com en f1dash leest het nooit). Zonder argumenten de sessie die nu bezig is
  of binnen het uur begint; neemt op tot start + 2 uur (race 4 uur), verbindt opnieuw na 5 minuten
  stilte en voegt toe (`a`), dus herstarten gaat door in dezelfde opname. **Start vóór de sessie**: de
  feed stuurt alleen wat verandert, een opname die halverwege begint mist de laps ervoor (zie "Late
  start" hieronder: wat erna komt klopt wel). `--wait`: geen sessie nu, dan wachten tot een uur voor
  de volgende. **Vanuit de topbalk** (REC, `features/live/RecorderMenu.tsx`, `live/recorder.py`,
  `GET/POST/DELETE /api/live/recorder`, `?wait=true`): de recorder draait als eigen proces
  (`start_new_session`), dus een herstart van de backend of Ctrl-C op `make dev` stopt hem niet; pid
  in `<LIVE_DIR>/recorder.json`, uitvoer in `recorder.log`, stoppen = SIGINT. Starten weigert zonder
  F1 TV-login (403, met het commando). Test de knop nooit echt (dat verbindt met F1): de API-test
  gebruikt een slapend proces als recorder.
- **Opslag**: `backend/data/live/<jaar>/<event>/<sessie>/` met `live.txt` (de feed zoals FastF1 hem
  schrijft), `meta.json` (jaar, ronde, code) en `converted/` (de archiefbestanden, plus `live.json` met
  het geplande aantal laps, `<DRV>/<lap>_tel.json.gz` en `track-v1.npz`). Niet in `.cache`: na afloop
  is de opname de enige kopie. `converted/` is weggooibaar (wordt opnieuw gemaakt). `F1DASH_LIVE` wijst
  een andere map aan. `sources/tracinginsights.fetch_json` kijkt eerst in `converted/` (wint van het
  archief; de simulator zet dat uit met `ti.READ_LIVE = False`).
- **Formaat** (`feed.py`): per regel de Python-repr van `[topic, data, utc]`; de toestand die F1 na
  het abonneren stuurt is `[topic, json_string, '']` (geen tijd). FastF1's eigen lezer gooit die weg
  en breekt op apostrofs (`'` → `"`); wij lezen met `ast.literal_eval`. `.z`-topics zijn base64 +
  raw deflate. Toestand zonder tijd krijgt de tijd van het bericht ervoor (na een reconnect stuurt F1
  hem opnieuw).
- **Omzetten** (`convert.py`, `service.py`): elke 3 s (als er iets nieuws is) gaan de timing-berichten
  (alles behalve CarData.z/Position.z) in een `LiveTimingData` zonder bestanden naar
  `Session.load(livedata=…, telemetry=False)`: ~1 s voor een hele race. Dus dezelfde lap-logica als
  het archief (TracingInsights is met FastF1 gemaakt). Round-trip getest: Monza R en Q via de
  simulator geven dezelfde laptijden, sectoren, banden, stints, posities en pit-tijden.
  `tests/test_live_roundtrip.py` doet dat offline met een kleine nep-race (FastF1 krijgt een
  verzonnen schema, het netwerk staat dicht): draai hem na elke wijziging in `convert.py`.
  Valkuilen: **FastF1 cachet ook livedata-parses op `api_path`** (dan blijft live hangen op de
  eerste stand): altijd binnen `fastf1.Cache.disabled()`. Zonder uitslag maakt FastF1 een extra lap
  voor elke gelapte auto (`FastF1Generated`): die gaan eruit. `LapStartDate` is zonder telemetrie leeg:
  `lSD` = origin + `lST`. `session.total_laps` gooit `DataNotLoadedError` als LapCount ontbreekt.
  `convert.load_session` zet FastF1's Ergast-aanroepen uit (uitslag en lap-1-tijden: tijdens een
  sessie leeg, zonder cache 2 requests per omzetting, jolpica staat ~500/uur toe) en laadt weer en
  race control alleen als ze in de opname zitten (anders haalt FastF1 ze bij F1, 401). De
  DriverList-toestand telt vanaf t = 0: FastF1 slaat drivers over die na een uur pas genoemd worden.
- **Late start** (`convert.joined_late`, `Joined`): F1's toestand bij het inschrijven zegt wat er al
  gebeurde, maar FastF1 leest hem alsof het nu gebeurt. Dus vóór FastF1: `NumberOfLaps` en de
  tijden van de laatste lap uit de TimingData-toestand (anders een verzonnen lap, en door de
  5-s-regel de tijd van de volgende lap een lap te vroeg), `InPit: false` (FastF1 telt pas laps na de
  pit), van de stints alleen de huidige met zijn leeftijd als `StartLaps`. FastF1's `_align_laps` uit
  (die vergelijkt per eigen lapnummer, bij een late opname verschillende echte laps). Daarna in
  `lap_columns`: lapnummers + laps vooraf, stints + `NumberOfPitStops` vooraf, de eerste lap begint op
  `sesT − tijd` (race lap 1: de start uit SessionData), en de pit-exit op het instapmoment vervalt.
  Getest met `simulate --join <t>` (de opname begint pas op t, met de samengevoegde toestand, lijsten
  zoals F1) op Monza R (lap 1, 22, 43), Q en FP2: alles na de instap gelijk aan het archief, behalve
  pit-exits van vóór de opname. Tijdlijn: `first_lap` (lapnummer van `lap_starts[0]`).
- **Tijdas live**: sessietijd 0 = het **geplande begin** uit het schema (stabiel, ook als de recorder
  later start of herstart); t0 = `lSD − lST` klopt daarmee vanzelf. Elke omzetting verhoogt de
  generatie van de sessie (`generations.py`); `@session_cache` sleutelt daarop, zodat laps, tijdlijn,
  strategie en tower opnieuw rekenen en archiefsessies gewoon gecachet blijven. De tijdlijn neemt het
  aantal laps uit `live.json` (anders zou de tower bij de laatste binnengekomen lap "finished" zeggen);
  `TimingIndex.live`: een auto zonder passage in de laatste 180 s is pas dan uitgevallen.
- **Posities** (`track.py`): Position.z op hetzelfde 4 Hz-raster als de replay, 1 s achter het nieuwste
  sample. Lap-voortgang = NumberOfLaps (TimingData, op het moment dat hij kwam) + projectie op de
  outline van de baan (`Circuit.track_distance`); vlak voor de lijn met een verse telling telt hij
  nog als de vorige lap. Op Monza gemiddeld 12 m van het archiefspoor. `Status` OffTrack = niet tonen.
  Na afloop wordt het spoor `converted/track-v1.npz`; een opname gebruikt **nooit** het archiefspoor
  (andere tijdas). Ontbreekt de npz, dan maakt `positions/prepare` hem opnieuw uit de opname.
- **Telemetrie per lap** (`telemetry.py`): CarData.z + Position.z van een afgeronde lap op één tijdas
  (getallen geïnterpoleerd, gear/brake/DRS vastgehouden), afstand geïntegreerd uit de snelheid, als
  `<DRV>/<lap>_tel.json.gz`. Op Monza 0,2–0,4% van de archieflengte. Opslag compact (`array('d')`).
- **Circuit**: TracingInsights' `corners.json` van deze sessie, een andere van het weekend, of vorig
  jaar (`_borrow_corners`); de feed heeft geen outline.
- **Tower live** (`live/tower.py`): de tower uit de laps loopt live tot ~4 s achter en kent een auto
  bij een late opname pas na zijn eerste passage. `FeedTower` houdt per auto bij wat TimingData zegt
  (positie, `GapToLeader`/`IntervalToPositionAhead`, in FP `TimeDiffToFastest`/`…ToPositionAhead`,
  in Q `Stats` per deel en `KnockedOut`, InPit/Retired/Stopped, NumberOfLaps; banden uit
  TimingAppData), de toestand bij inschrijven vanaf het begin. Zolang de sessie live is legt
  `replays.timing_state` dat over de tower uit de laps (`tower.overlay`): F1's volgorde, gaps en
  status; sectoren, banden en paars/groen blijven uit de laps. `valid_until` = de volgende wijziging
  in de feed (min. 0,25 s). Na afloop alleen de laps (zoals het archief). De simulator stuurt in Q/FP
  posities en verschillen uit de archief-tower (race: bij de lijn, zoals altijd).
- **Mini-sectoren** (F1's `Segments` in TimingData, de streepjes van de officiële timing):
  `FeedTower` houdt per auto de status per segment bij (toestand als lijsten, updates als dicts per
  segment) als string per sector (`"ygp|y--|---"`, `tower.encode_segments`); `TowerRow.segments`.
  Codes: 2048 geel, 2049 groen (PB), 2051 paars, 2064 pitstraat, 0 nog niet gereden; onbekende
  codes als bits gelezen en één keer gelogd. Na afloop `converted/segments.json` (`finish`), zodat
  de replay van een opname ze ook heeft (`replays._segment_history`, `tower.with_segments`); het
  archief heeft ze niet. Frontend: streepjes van 2 px onder de sectortijden (kolom `segments`).
  De simulator verzint ze uit de telemetrie (elke sector in gelijke stukken van ~260 m, statussen
  in tijdsvolgorde over alle auto's, het eerste segment van een nieuwe lap wist de rest); wanneer
  F1 ze echt wist en hoeveel segmenten per sector het zijn, zien we pas bij een echte opname.
- **Live of klaar**: een opname is live als hij de laatste 2 minuten is geschreven en F1 hem niet
  heeft afgesloten (`Finalised`/`Ends`; de heartbeats gaan door). Daarna één laatste omzetting,
  telemetrie, npz, en het geheugen gaat vrij. Groeit een klare opname weer (`grows_again`: de
  recorder verbindt pas na 5 minuten stilte opnieuw, of een nieuwe opname op dezelfde plek), dan wordt
  hij opnieuw gelezen; heartbeats na `Ends` tellen niet.
- **API**: `GET /api/live` (opnames, live eerst) en `GET /api/live/{y}/{r}/{s}/events` (SSE): `status`
  (`LiveSessionInfo`: horizon, versie, F1-status) bij elke verandering en `positions` met de nieuwe
  punten (`first`, `count`, `cars`). SSE en geen websocket: één richting, herverbindt zelf, gaat
  zonder iets door de Vite-proxy; de GZip-middleware slaat `text/event-stream` over.
- **Frontend**: `useLiveSession` (App) opent de SSE voor de geselecteerde live sessie. Nieuwe versie
  → alle sessie-queries ongeldig behalve markers, positions en circuit; de tower (`useTimingState`)
  vraagt opnieuw. Posities: `appendPositions` plakt ze in de gedeelde query-data (typed arrays met
  ruimte om te groeien; `structuralSharing: false`). Klok: `setLiveEdge` (horizon − 2 s: posities lopen
  achter), `goLive` (volgen op 1× met instelbare vertraging, localStorage `f1dash-live-delay`); elke
  seek/pauze/snelheid stopt het volgen; End = terug naar live. `useSessionClock` laadt alleen bij een
  andere sessie (anders `setRange`, de klok blijft staan). LIVE-knop en vertraging in de klokbalk,
  `LiveBadge` in de topbalk.
- **Testen zonder live sessie** (`simulate.py`): zet een archiefsessie om naar feed-berichten zoals
  FastF1's parsers ze lezen (TimingData per timingpunt, TimingAppData-stints, Position.z en CarData.z
  op 4 Hz, race control, weer, LapCount, sessiestatus; Q2/Q3 via `BestLapTimes`) en schrijft ze in
  tempo. Wat de simulator niet nabootst (posities vóór de start, garage, gele track status) kan in
  een echte feed anders zijn: de opname blijft ruw bewaard, dus fouten zijn achteraf te herstellen
  (`converted/` weggooien).

## Live lap en Follow

Twee manieren om live (en in replay) telemetrie te volgen, allebei op de sessieklok:
- **Follow** (`store/groups.ts` `follow`, knop FOLLOW in de topbalk, sneltoets `l`): de laps van een
  groep schuiven mee naar de nieuwste lap van elke driver die op t af is, met behoud van de afstand
  ertussen (`lib/laps.ts` `followLatest`: VER L12 + L11 → L13 + L12). Live pas 4 s na de lijn
  (`LIVE_MARGIN`): de telemetrie van een lap wordt geschreven als de posities eromheen binnen zijn.
  Zelf laps kiezen (`toggleLap`/`setLaps`/`replaceLap`) zet Follow uit; `followTo` niet.
  `FollowLatest` is een eigen component dat niets rendert, zodat de klok de App niet re-rendert.
- **Live lap** (widget `livelap`, `GET .../lap-progress?driver=&t=&reference=previous|best`): de lap
  die de eerste driver van de groep op t rijdt, tot zover, op een raster van 5 m over de referentielap
  (`progress.on_grid`; `null` voorbij de auto, dus de chart over de hele lap groeit), met de delta.
  Replay: de afgeronde lap afgeknipt op t en uitgerekt naar de referentielengte zoals `/compare`
  (aan de lijn exact het laptijdverschil). Live: de samples tot t uit het geheugen van de recorder
  (`LiveSession.lap_samples`, met `Samples.copy`: een numpy-view op een `array('d')` blokkeert de
  appends van de live-thread), niet uitgerekt (de lengte is nog niet bekend; de delta drijft een paar
  honderdsten, op Monza gelijk aan het archief zonder uitrekken). Een lap die net af is maar nog geen
  bestand heeft komt ook uit het geheugen; de eerste 3 s na de lijn (`HOLD`) toont hij de net
  afgeronde lap. Pit-laps (lengte > 0,5% anders) worden nooit uitgerekt; out-laps (vanaf de garage)
  tonen geen delta. Referentie "Auto": vorige lap in een race, beste lap tot t in Q/FP (de lap ervoor
  is daar meestal een out- of cool-down lap). De frontend vraagt per hele seconde klok.

## Markeringen en views (fase 5)

**Twee soorten markeringen** in één tabel, altijd per sessie (niet per circuit: layouts en afstanden
verschillen per jaar):
- **Afstand** (`kind: distance`): een punt of bereik in meters vanaf de finishlijn, optioneel over één
  lap (`driver` + `lap`). Getekend in Telemetry en Delta (grijze band of stippellijn, label in de
  bovenste chart), op de Track map (band langs de baan of ring) en op de Track line. Zichtbaar in alle
  link-groepen; hoort hij bij een lap die in die groep niet geselecteerd is, dan fainter. De readout
  van Telemetry noemt de markering onder de cursor.
- **Tijd** (`kind: time`): een moment of periode op de sessieklok, optioneel met een driver. Op de
  klokbalk (klik = erheen), en de readout toont de notitie tot 8 s na een moment.

Maken: Shift + slepen/klikken in een chart, `m` (zoombereik, anders de cursor, anders typ je de
afstand), `⇧M` of het vlaggetje voor het moment, Shift + slepen op de klokbalk voor een periode. Eén
editor voor de hele app (`features/markers/MarkerEditor.tsx`, opent ook vanuit een popout in het
hoofdvenster). Bewerken of verwijderen: klik op een markering in een chart (punt binnen 5 px, bereik
erbinnen), dubbelklik op de klokbalk, of het potlood in het Markers-paneel. Tags: vrij, ontdubbeld zonder hoofdletters; suggesties zijn de vaste lijst in
`lib/markers.ts` plus de tags die al gebruikt zijn (`/api/markers/tags`).

**Kaart op afstand:** de outline van de kaart komt los van elke lap (MultiViewer, in decimeters, begint
ergens op de baan). `analysis.outline_distance` koppelt elk outline-punt aan een lapafstand via de
bochten (dichtstbijzijnde outline-punt per bocht, daartussen lineair, de lus dicht via de eerste bocht
een lap later). `Circuit.track_distance` en `lap_length` komen daaruit; Monza: elke bocht op 0,1 m.

**Opgeslagen views** zijn bladwijzers: sessie, laps per groep, zoom per groep, kloktijd en de layout van
het dashboard waar je stond. Openen zet dat allemaal terug en toont de layout in een eigen tab (die
tab onthoudt `viewId`, dus nog eens openen hergebruikt hem; opslaan koppelt de huidige tab). Een
andere sessie: de klok springt pas als de nieuwe tijdlijn er is (`clock.seekAfterLoad`). Links
`#view=<id>` openen de view bij het laden of bij een hash-wissel en halen de hash weer weg.

API: `GET/POST /api/sessions/{y}/{r}/{s}/markers`, `PUT/DELETE /api/markers/{id}`,
`GET /api/markers/tags`, `GET/POST /api/views`, `PUT/DELETE /api/views/{id}`. Responses hebben alle
velden (`json_schema_serialization_defaults_required`), inputs mogen velden met een default weglaten.

## Strategie (fase 6)

Alles uit de lapdata (geen telemetrie), rekenwerk in `strategy.py` (getest), per sessie in
`strategies.py`. Drie endpoints, bewust gescheiden naar hoe ze op de klok lopen:
- **`/race-history`** (één keer, volledig): per driver kolommen per lap (passeertijd `line`, `gap` tot de
  eerste die die lap afmaakte, `position`, laptijd, bandleeftijd, `clean`), plus stints, pitstops en de
  grid (Jolpica). De frontend filtert zelf op `line ≤ t`, dus gaps/posities/stints lopen per passage mee.
- **`/degradation?until=&fuel=`**: per stint een lineaire fit van brandstofgecorrigeerde laptijd op
  bandleeftijd, en per compound het veld (gewogen slope, mediane base).
- **`/pit-window?driver=&until=&fuel=&compound=`** (alleen race/sprint): pit nu → rejoin (positie, gaps,
  als niemand anders stopt) en undercut/overcut op de auto ervoor en erachter.
De frontend vraagt die twee laatste op met **`until` = einde van de laatste leiderslap** op de klok
(`lib/strategy.ts` `strategyCutoff`; buiten races per minuut), dus één query per ronde, gecachet. Klok
op het einde = `until` weg = alles.

Modelkeuzes (in de (i)-uitleg van de widgets ook):
- **Schone lap** (`is_clean`): getimed, geen pit in/out, niet lap 1, niet verwijderd, track status
  alleen 1/2 (geen SC 4, rood 5, VSC 6/7). Per stint ook geen laps > 107% van de snelste schone lap
  (cool-down laps in Q/FP). Fit: kleinste kwadraten, uitschieters (> max(0,6 s, 2,5σ)) eruit en
  opnieuw, max 3 rondes, minstens 4 laps.
- **Brandstof**: `fuel` s/kg (standaard 0,03) × 100 kg / racelaps per lap; gecorrigeerd =
  laptijd − fuel_per_lap × (totaal − lap). Buiten races 1,8 kg/lap en de laatste lap van de sessie als
  referentie: dan zeggen alleen de slopes iets. Zonder correctie lijken race-stints "sneller" te worden.
- **Pitverlies per stop**: in-lap + out-lap − 2 × mediaan van de schone laps tot 3 laps eromheen.
- **Undercut** (`first_gain`): jij stopt volgende lap, de ander k laps later; tijd tot beiden op nieuwe
  banden. Oude band = eigen stintfit, nieuwe = compoundfit + eigen tempo-offset (stintbase −
  compoundbase); een compound zonder data = "zo snel als een nieuwe set van de huidige" (staat in
  `notes`). Pitverlies valt weg (gelijk voor beiden); tempoverschil tussen de twee telt wel mee.
  Nieuwe band automatisch: hard na soft/medium, medium na hard.
- **Ghosts** (frontend, `lib/replay.ts` `pitGhost`): de eigen positie van de auto `pit_loss` seconden
  geleden op het positiespoor; rejoin-positie = 1 + auto's met meer lap-voortgang nu. Twee per
  geselecteerde driver: PIT (`Circuit.pit_loss`) en SC (`pit_loss_sc`, gestippeld). Op de kaart met
  alle auto's en op de Track line (instelling "Pit stop ghosts").
- **Lap-charts** (`LapChart`): x = lapnummer op de lijn, vaste x-range (0 of 1 tot het totaal) zodat de
  chart niet verspringt; uPlot `cursor.sync` per link-groep; SC/VSC/rood als banden via
  `lapAxis` (sessietijd → leiderslap). Data hangt aan `crossingsKey` (aantal passages), niet aan t.

## Domeinkennis & FastF1-valkuilen

Lees dit voordat je data-code schrijft. Fouten hier geven grafieken die er goed uitzien maar niet kloppen.

- **Cache altijd aan**: `fastf1.Cache.enable_cache("backend/.cache/fastf1")`. Een sessie voor het eerst
  laden duurt 10–60 s; daarna seconden. De frontend moet dus een duidelijke laadstatus tonen.
- **Eigen cache**: ruwe bronbestanden staan gzipped in `backend/.cache/<bron>/`. Berekeningen (compare,
  mini-sectoren) zijn snel genoeg (<10 ms) om niet op te slaan; alleen in geheugen via `lru_cache`.
- **Sessie in geheugen houden**: geladen `Session`-objecten in een LRU-cache (een paar sessies), niet
  per request opnieuw `session.load()`.
- **Rate limits**: FastF1 heeft ingebouwde limieten op de bron-API's. Geen loops die tientallen
  sessies achter elkaar laden zonder reden.
- **Telemetrie pas vanaf 2018.** Daarvoor alleen laptijden/resultaten.
- **Samplefrequentie is laag**: car data ~4 Hz, positie ~4 Hz (niet synchroon). `lap.get_telemetry()`
  merget en interpoleert beide en voegt `Distance` toe. Mini-sectoren kleiner dan ~50 m zijn ruis.
- **Brake is boolean (FastF1 0/1, OpenF1 0/100), geen remdruk.** Throttle is 0–100 (soms glitches >100 of 104: clampen).
  Laat in de UI geen "brake pressure" suggereren.
- **DRS** is een code, geen boolean: 10/12/14 = open (afhankelijk van jaar), 8 = beschikbaar.
  Normaliseer in de backend naar `drs_open: bool | null` (null vanaf 2026).
- **Gebruik `pick_drivers()`**, niet het deprecated `pick_driver()`. `pick_fastest()` voor snelste lap.
- **Ongeldige laps**: let op `Deleted`, `IsAccurate`, pit in/out laps (`PitInTime`/`PitOutTime`) en
  `TrackStatus` (SC/VSC/rood). Filter die standaard uit bij pace-analyse, maar laat ze wel zien in tabellen.
- **Tijdassen**: laps (`Lap.start_time` = `lST`), weer (`wT`) en telemetrie gebruiken sessietijd in
  seconden; race control heeft UTC. Elke lap in `session_laptimes.json` heeft ook `lSD` (UTC-datum van de
  lapstart), en `lSD − lST` is per sessie exact constant (getest op Monza Q en R): dat is t0 (UTC).
  Sessietijd van een telemetrie-sample = `lST` van de lap + `tel.time`.
- **Timedelta/NaT**: FastF1 gebruikt pandas `Timedelta`. Converteer in de backend naar seconden
  (`float`, ms-precisie) en NaT naar `null`. Nooit timedelta-strings naar de frontend sturen.
- **Corner-segmenten** (`analysis.corner_segments`): grens op de topsnelheid van de referentie tussen
  twee bochten, dus segment = remzone + bocht + uitaccelereren. Bochten < 150 m uit elkaar of zonder
  remmen ertussen (< 400 m) worden één segment (T1–2, T8–10). Rempunten op ~4 Hz data zijn ±10–20 m;
  de frontend noemt verschillen onder 10 m / 3 km/h daarom niet als oorzaak.
- **Delta-tijd zelf berekenen**: `fastf1.utils.delta_time` is onnauwkeurig (staat ook zo in de docs).
  Methode (`analysis.compare`): elke lap uitrekken naar de lengte van de referentielap (de rijlijnen
  verschillen een paar meter), resamplen op een grid van 5 m, tijd interpoleren, delta = t_b(d) − t_a(d).
  Daardoor is de delta aan de finish exact het verschil in laptijd. Gear/brake/drs niet interpoleren
  maar de laatste sample nemen.
- **Mini-sectoren**: lap opdelen op afstand (standaard 25 gelijke stukken, configureerbaar), per driver
  de tijd per stuk via interpolatie op het afstandsgrid. Fastest = paars, PB = groen, rest = geel.
- **Track map**: X/Y uit positiedata; rotatie via `session.get_circuit_info().rotation`.
  Corner-nummers ook uit `get_circuit_info().corners`.
- **Teamkleuren** komen uit `drivers.json` (`tc`) → `DriverInfo.color`. Twee drivers van hetzelfde team:
  de tweede gestippeld.

## Stijl (referentie: Red Bull RaceX op de pitwall)

Doel: dichte, rustige, functionele schermen. **Geen AI-slop**:
- Geen kaarten met schaduw, geen grote afgeronde hoeken (max 2px), geen kleurverlopen, glas-effecten,
  emoji, hero-teksten of "welkom"-schermen. Geen lege ruimte als decoratie.
- Bijna zwarte achtergrond, panelen gescheiden door 1px-lijnen. Paneel = titelbalk (~24px) met tabs,
  tandwiel en sluiten, daaronder direct de inhoud.
- **Getallen**: monospace of `tabular-nums`, rechts uitgelijnd, vaste precisie (1:18.792, 26.262, +0.077).
  Tijden altijd als `m:ss.mmm` en gaps als `+s.mmm`.
- **Kleur alleen met betekenis**: paars = overall beste, groen = persoonlijk beste, geel = langzamer of
  in/out-lap, rood = in de pit, stop of probleem. Teamkleuren alleen voor de lijnen en labels van een driver.
  Al het andere is wit of grijs.
- Banden als letter in een gekleurd rondje (S rood, M geel, H wit, I groen, W blauw).
- Kleine letters (11–12px in tabellen), korte labels in hoofdletters voor kolomkoppen.
- Interactie: hover laat de waarde zien, klik selecteert, en alles is met het toetsenbord te bedienen.

## UX-principes

- **Geleidelijk meer laten zien:** begin met een rustige layout en laat de gebruiker zelf widgets
  toevoegen. Presets van simpel ("Quali-duel") tot dicht ("Engineer").
- **Elke widget legt zichzelf uit:** een (i)-knop met wat je ziet en waar je op moet letten.
- **Automatische inzichten boven ruwe data:** bv. "NOR wint 0,12 s in T4 door later te remmen". Dat
  maakt het dashboard bruikbaar zonder engineer-kennis.
- **Compacte modus** voor wie veel tegelijk wil zien (kleinere fonts, minder padding).

## API-conventies

- Alles onder `/api/...`. Een sessie: `/api/sessions/{year}/{round}/{session}` met `session` een van
  `FP1 FP2 FP3 SQ SS S Q R`. Laps als `DRV:nummer` of `DRV:fastest` (snelste getimede, niet-verwijderde lap).
- **Kolom-georiënteerde JSON** voor telemetrie: `{ "distance": [...], "speed": [...], ... }`,
  niet een array van objecten. Scheelt veel bytes en past direct op uPlot's dataformaat.
- Eenheden: afstand in meters, tijd in seconden (float), snelheid in km/h. In veldnamen geen eenheden,
  wel in de Pydantic-docstring.
- Driver altijd als 3-letter code (`VER`, `NOR`) in API-paden en responses.
- Response-modellen in `backend/app/schemas.py`; frontend-types genereren uit OpenAPI, niet handmatig
  dupliceren.

## Frontend-conventies

- **Link-groepen**: elk paneel hoort bij een groep (kleur). Een groep heeft een eigen selectie (laps,
  drivers) en een eigen cursor/zoom. Panelen in dezelfde groep volgen elkaar, andere groepen niet.
- **Gedeelde cursor** per groep (afstand in meters). Hover in een telemetrie-chart → alle charts en de
  track map in die groep tonen dezelfde positie. Cursor-updates gaan via een subscribe, niet via
  React-renders (anders hapert het).
- **Sessieklok**: replay en (later) live leveren allebei "tijd t". Widgets vragen de toestand op t en
  weten niet welke bron erachter zit. Zie "Replay". Sneltoetsen: Space, ← → (10 s), - = (snelheid),
  Home/End. Markeren: `m` (afstand), `⇧M` (moment).
- Widgets zijn losse componenten in `frontend/src/widgets/<Naam>/` met een registry
  (`widgets/registry.ts`). Nieuwe widget = component + `widget.ts` met `defineWidget({ id, title,
  description, help, defaults, settings, component: lazy(...) })` + entry in de registry. Volgt hij
  de sessieklok, zet dan `followsClock` (of een functie van de config): afspelen op een dashboard
  zonder zo'n paneel toont in de klokbalk "No panel here follows the clock" met "Open Replay".
- Kleine panelen (Clock): `constraints: { minimumHeight }` in de widget-definitie. `addWidget` geeft
  die door aan dockview (dat anders minimaal 100 px houdt) en ze gaan mee in de layout.
- Dropdowns in titelbalken (`HeaderMenu`) gaan via een portal naar de body met `position: fixed`,
  anders knipt dockview ze af en liggen de panelen eronder erover; ze scrollen als ze te lang zijn.
- Een knop **in** een paneel die een instelling wisselt (Clock: LOCAL/SESSION) gebruikt
  `setConfig(patch)` uit de widget-props: dezelfde opslag als het tandwiel (alleen wat afwijkt).
- **Paneel-instellingen** zijn declaratief: het type van het config-veld bepaalt de control (boolean =
  aan/uit, array = meerdere aan/uit, anders één keuze). Ze staan in de panel-params (`config`, alleen
  wat afwijkt van de defaults) en dus in de layout. `resolveConfig` valt terug op de default als een
  bewaarde waarde niet meer past, zodat oude layouts blijven laden.
- Een paneel met andere compare-opties (resolutie, mini-sectoren) haalt een eigen `/compare` op; panelen
  met dezelfde opties delen de query.
- Widgets halen hun data via TanStack Query hooks in `src/api/`, zodat dezelfde data niet twee keer
  wordt opgehaald als twee panelen hem gebruiken.
- Dashboards: elke tab heeft een eigen dockview-layout (`store/dashboards.ts`, localStorage
  `f1dash-dashboards`); export/import als JSON-bestand via het Layout-menu.
- **Sneltoetsen en commando's** staan op één plek (`features/commands/commands.ts`) en werken op de
  link-groep van het actieve paneel. Nieuwe actie = één entry daar; de palette toont hem vanzelf.
- **"Pogingen"** (`attempts` in `lib/timing.ts`): getimed, geen pit-lap, binnen 107% van de beste lap van
  de driver. Gebruikt door lap-stappen, overlay en de Run timeline (cool-down laps).
- Alleen donker thema (geen light mode). Alle kleuren als tokens in `src/index.css`, nooit hardcoded.
- Performance: telemetrie-arrays nooit in React state die vaak re-rendert; uPlot direct updaten.

## Code-stijl

- Code, identifiers en comments in het Engels; documentatie (CLAUDE.md, ROADMAP.md) in het Nederlands.
- Python: type hints overal, ruff voor lint/format, pure functies voor berekeningen (delta, mini-sectoren)
  zodat ze los te testen zijn.
- TypeScript: strict, geen `any`. Prettier-config in de repo aanhouden.
- Tests vooral op de rekenlogica in de backend (delta, mini-sectoren, resampling). UI-tests alleen
  waar het echt iets oplevert.
