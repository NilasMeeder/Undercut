# F1 Pitwall Dashboard

Hobbyproject: een geavanceerd F1-analysedashboard in de stijl van een pitwall. Laptijden vergelijken,
mini-sectoren, telemetrie (speed/throttle/brake/gear/RPM/DRS) van meerdere drivers of laps over elkaar,
en een zelf in te delen dashboard met widgets.

**Prioriteit: snelheid en bruikbaarheid > uiterlijk.** Het moet eruitzien als echte pitwall-software,
niet als een AI-dashboard. Zie "Stijl" hieronder. Veel features mag, maar op een goede basis.

Vier modi op dezelfde onderdelen: analyse, replay, strategie en live. Zie `ROADMAP.md` "Visie".

Zie `ROADMAP.md` voor fases en status. Werk de checkboxes daar bij als iets af is.

## Huidige status

Fase 0 t/m 6 zijn af: een docking-dashboard (dockview) met negenentwintig widgets (Laps, Telemetry, Delta,
Live lap, Release, Track map, Bests, Speed traps, Speed map, Teammates, Battles, Weekend, Run timeline, Corners, Mini-sectors, Energy, Tyre sets, Report, Clock, Race control, Weather,
Timing tower, Track line, Markers, Stints, Gaps, Positions, Race pace, Pit window), link-groepen, gedeelde cursor/zoom,
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
sessie (zie "Live"). Fase 8 (energie 2026) is gebouwd: waar een auto bij vol gas geen snelheid meer
wint terwijl de beste laps op die straight dat wel deden (clipping), en wat dat kost; widget Energy,
strookjes in de speed-chart, kanaal Deploy en terugschakelen bij vol gas (zie "Energie"). Fase 9 is
gebouwd: twee werkplekken, Analyse en Pitwall, elk met eigen tabs, en het sessieverslag Report in de
preset Debrief (zie "Werkplekken"). Fase 10 (2026-10-18): Q-cut en voorspelde laptijd in de tower,
Qualifying-presets (Analyse en Pitwall), Mini-sectors, Tyre sets, Speed map, Teammates, Battles,
Weekend en Release (zie ROADMAP.md fase 10 en de secties hieronder). Fase 11: de straight-mode-zones
van de FIA (2026) op de kaart en in Telemetry/Delta (zie "Straight mode").

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
- Werkplek: de tab-preset bepaalt de werkplek (`replay`/`pitwall` → Pitwall, de rest → Analyse), dus
  de truc hieronder opent vanzelf in Pitwall; `?ws=analysis` of `?ws=pitwall` in de URL dwingt het
  af. In Pitwall staat de AT CLOCK-schakelaar niet in de klokbalk en zijn de panelen op slot
  (tandwiel en (i) blijven, +, sluiten en popout pas na een klik op EDIT). Wisselen: toets `w`; tabs: `1`–`9`. Report: preset `debrief`,
  regels zijn knoppen (`getByRole('button', { name: /loses 0.143/ })`).
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
- Energie: Monza 2026 Q (ronde 13) is de vaste testsessie (`useDefaultSelection` kiest GAS L17 en
  RUS L16). Controlegetallen: 97 schone laps, straights →T1, →T4, →T8, →T11; →T1 sessie 99% clip,
  mediaan 393 m, 0,116 s; GAS L17 kost ≈0,15 s per lap (meest →T11, 394 m), RUS L16 ≈0,03 s. In
  SESSION is COL de zuinigste (0,149 s/lap) en STR de duurste (1,295). Energy zit als tab achter
  Corners in de preset Engineer; het (koude) eerste verzoek leest alle schone laps (~1 s Q, ~2 s R).
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
backend/app/energy.py      pure energie-logica (2026): kinematica op een tijdraster (a uit de snelheid, helling,
                           dwarsversnelling), vol-gas-stukken, omhullende per straight, clipping en de kosten;
                           energies.py: per sessie (schone laps, cache per lap die generaties overleeft)
backend/app/straight_mode.py straight-mode-zones (2026): de FIA-punten uit straight_mode.json op de lap, eind
                           waar de straight remt; sources/fia.py leest de FIA-kaart en schrijft die JSON
backend/app/zones.py       zones voor de kaart: DRS-zones uit de flap (race: uit Q), of de straights met clippunt (2026)
backend/app/reports.py     sessieverslag (/report): waar de tijd zit, long runs, degradatie, clipping, race-momenten;
                           pure functies (long_runs, start_moves, stop_extremes, undercuts, flags) getest
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
                           markerEditor.ts (de open markering-editor: markNew, editMarker), live.ts (live-status),
                           sync.ts (sessie en laps delen tussen vensters)
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
                           lijnstijlen), laps.ts (lap/driver stappen), insights.ts (zinnen voor Corners), energy.ts
                           (zinnen en namen voor Energy), report.ts (zinnen voor Report), table.ts,
                           replay.ts (auto op t interpoleren, klokformaat, pit-ghosts), markers.ts (labels, plaats
                           als tekst), strategy.ts (cutoff, volgorde op t, lap-as, SC-banden)
frontend/src/features/     topbalk: session/ (SessionPicker, GroupBar, useDefaultSelection), commands/ (⌘K en
                           sneltoetsen), dashboards/ (tabs, Layout-menu met presets en export/import),
                           clock/ (ClockBar onderin, useSessionClock), markers/ (MarkerEditor, actions:
                           springen en markeren), views/ (ViewsMenu, openen/opslaan, #view=-links),
                           live/ (LiveBadge: een live sessie die niet open staat, RecorderMenu: REC),
                           workspace/ (ANALYSIS | PITWALL, EDIT en schermvullend, klok per werkplek),
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

**2026-regels:** DRS bestaat niet meer (active aero + overtake mode). In de 2026-data is `drs` altijd 0
(de backend maakt er `null` van), en er is geen kanaal voor wingstand of energie-inzet (F1 heeft ze
na de wintertests uit de feed gehaald, FastF1 #861). Zie "Straight mode". Het DRS-kanaal dus alleen tonen als er data is.

## Replay (fase 4)

**Eén tijdas:** sessietijd in seconden (zie "Tijdassen"). De sessieklok (`store/clock.ts`) is globaal en
loopt buiten React om, net als de cursorbus: `clock.subscribe` tikt elke frame tijdens het afspelen
(kaarten tekenen imperatief via `useClockDraw`), `useClockTime(ms)` re-rendert tabellen gedoseerd.
Bij het laden van een sessie staat de klok op het **einde**, zodat widgets die de klok volgen (race
control) in analyse-modus gewoon alles tonen. Live (fase 7) wordt een andere bron voor dezelfde klok.

**AT CLOCK** (schakelaar in de klokbalk, `c`, `store/atClock.ts`, standaard aan, localStorage
`f1dash-at-clock`): Laps, Bests, Speed traps en Run timeline tonen dan alleen de laps die op de klok
af zijn (`end_time ≤ t`), dus ook paars/groen en de theoretische beste zoals ze toen waren. Klok op
het einde = alles (ook laps zonder eindtijd). Per paneel overschrijft "Laps shown" (`scope`:
`app` = de schakelaar, `clock`, `session`) dat. Eén hook: `widgets/useLapsAtClock.ts` (zoals
`useLaps`, maar rendert alleen opnieuw als er een lap bij komt of af gaat). De lap-commando's
(`[` `]` `,` `.`, palette) blijven binnen die laps; een geselecteerde lap die nog niet gereden is
blijft staan maar is vaag in de topbalk. Telemetry, Delta en Corners tonen wat geselecteerd is.

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
- **Kwalificatie in de tower**: kolom Cut (binnen de lijn de marge op de eerste die eruit ligt,
  negatief; eronder wat nog nodig is) en de cut-tijd in de kop, uit de beste laps van de rijen.
  Kolom Pred (`/predictions?t=`, `progress.predict`): per auto op een push-lap zijn beste lap tot t
  plus de delta op dit punt (zoals Live lap, `lap_in_progress` met referentie "best"), en de positie
  die dat geeft tussen de beste laps van de rest. Niet op een out-lap, niet in de eerste 300 m,
  niet als hij al ≥ 1 s achter ligt (cool-down). Monza 2025 Q: NOR L20 op 95% 1:18.862, werkelijk
  1:18.869. Frontend vraagt per hele seconde klok (`usePredictions`). Live lap toont hetzelfde per frame
  ("→ 1:18.582" naast de delta: referentie + delta op de auto, vanaf 300 m).
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
  is daar meestal een out- of cool-down lap). De frontend vraagt per hele seconde klok, **2 s vooruit**
  (`AHEAD`), en knipt de lijnen elk frame af op de klok (`time` per gridpunt, `setData` via
  `UPlotChart`'s `chartRef`; y-as op het zichtbare deel): de lijn groeit vloeiend en de getallen
  bovenin lopen per frame mee. Tot de klok op de nieuwe lap is en 3 s erna (`HOLD`) staat de
  afgeronde lap er, apart gevraagd op zijn eindtijd − 1 ms (`precise`), met de eind-delta. Lijnen
  zijn voor het tekenen licht gladgestreken (driehoek over ±10 m); de getallen zijn ruw.

## Energie (fase 8)

Er is geen kanaal voor de batterij of de MGU-K, dus het is een schatting, en de UI zegt dat ook. Het
idee: bij vol gas versnelt een auto zo hard als zijn vermogen toelaat, en met de MGU-K erbij is dat
veel meer dan op de motor alleen (Monza 2026 bij 230 km/h ~9 tegen ~3,5 m/s²; boven ~300 km/h haalt
de motor alleen niets meer). Alles in `energy.py` (puur, getest met gesimuleerde laps) en
`energies.py` (per sessie). Wat er gebeurt:
- **a uit de snelheid**: lap op een raster van 0,1 s, a = helling van een rechte lijn door de snelheid
  over ±0,5 s, **binnen** het vol-gas-stuk (anders lekt het remmen erin en lijkt elke straight 40 m
  te clippen), plus g × helling uit z (decimeters, over ±50 m), zodat een klim geen clipping is.
  TracingInsights' `acc_x` is gewoon de afgeleide van speed en live ontbreekt hij: niet gebruiken.
- **Straights**: vol gas (≥ 95%, geen rem, geen gat > 1 s in de data; dipjes < 0,3 s tellen niet) over
  ≥ 250 m, genoemd naar de bocht waarvoor hij remt (`corners.json` geschaald naar de laplengte) en de
  bocht waar hij begint. De vorige lap gaat er 3 km voor (negatieve afstand), zodat het rechte stuk
  over de finish heel blijft (Baku: ~2,2 km tot de lijn); een stuk dat door de lijn wordt afgesneden
  hoort bij de volgende lap. Een straight telt als ≥ 50% van de schone laps hem heeft (een lift
  onderweg geeft anders een extra stukje, Spa T9–10).
- **Bochten op vol gas niet beoordelen**: dwarsversnelling v² × kromming (uit x/y over ±30 m) > 10 m/s²
  (Curva Grande, Raidillon, Blanchimont): daar bepalen grip en luchtweerstand de snelheid. Zonder dit
  leek Raidillon 900 m clipping.
- **Omhullende per straight**: per lap eerst de mediaan van a per snelheidsbin van 5 km/h (dat middelt
  de ruis van hele km/h op 4 Hz uit), dan over de schone laps het 95e percentiel (min. 3 laps per
  bin). De top eindigt op de hoogste gemeten snelheid. **Nooit lenen van andere straights**: op Baku
  zet niemand de hele 2,2 km vol in, en de versnelling van een kort stuk op dezelfde snelheid gaf
  een klif in de omhullende. Een 95e percentiel over losse samples zat 0,3–0,7 m/s² te hoog (ruis).
- **Clipping**: a < 0,5 m/s² terwijl de omhullende ≥ 1 m/s² meer zegt, op beoordeelde punten, in
  stukken ≥ 40 m. De kost: een auto die vanaf het eerste clippunt de omhullende volgt (dezelfde
  helling op; in bochten doet hij wat de lap deed), tot het eind van vol gas, nooit sneller dan de
  top van de omhullende. Telt alleen als dat ≥ 3 km/h scheelt (anders zit de auto aan zijn
  luchtweerstand). Precisie: het venster van 1 s laat het clippunt tot ~40 m te laat beginnen.
- **Inzet** (`energy.deploying`, `EnergyStraightLap.deploying`): waar een auto duidelijk meer wint
  dan de motor alleen kan. Motor alleen = de omhullende van de **hele sessie** (alle straights:
  volle inzet op die snelheid, waar dan ook gezien) min wat de MGU-K toevoegt, `K_POWER` /
  (`MASS` × v) met 280 kW (bij 230 km/h ~9 tegen ~3,5 m/s², dus geen 350) en 800 kg, plus 1 m/s²
  marge, minstens `FLAT`; pas vanaf 200 km/h (daaronder beperkt grip). Niet de omhullende van de
  straight zelf: uit de Parabolica zet niemand in (3–4,7 m/s² bij 240 km/h), dan leek elke winst
  inzet. Boven ~300 km/h wint de motor alleen niets meer, dus daar is elke winst de batterij.
  Monza 2026 Q, RUS L16 →T1: inzet vanaf ~−100 m (a springt van 3 naar 6 m/s²) tot 370 m.
- **Lift and coast**: ≥ 60 m van lift tot rem (gewoon van gas naar rem is ~30 m).
- **Wat het niet weet**: slipstream en (race) overtake mode zitten in de omhullende, dus in een race
  lijkt iedereen meer te clippen; een zwakkere motor en minder inzet zijn niet te scheiden.
- **Kosten en cache**: `get_session` leest alle schone laps (archief: eerst `ti.prefetch` in bulk;
  een opname heeft ze al, dus geen prefetch naar TracingInsights). Het werk per lap (`_lap_runs`)
  is een gewone `lru_cache` op (lap, laptijd, eindtijd), dus het overleeft de generaties van een live
  sessie; per generatie alleen de omhullende en de analyse (~0,1 s voor een race).
- **API**: `/energy?laps=` (zoals `/compare`: afstanden op de schaal van de eerste lap) en
  `/energy/session` (per driver en straight de medianen over de schone laps).
- **Deploy** (`energy.deploy`, `/energy?step=`): a als % van de omhullende op die snelheid (de
  noemer minstens 1 m/s², anders wordt 0,1 van 0,2 al 50% vlak voor de top; zo blijft snelheid
  verliezen bij de top zichtbaar als oogsten), geklemd op −100…150, NaN in snelle bochten en
  stukjes < 0,5 s ertussen. Op het raster van `/compare` (zelfde `make_grid` op de lengte van de
  eerste lap), dus de frontend legt de arrays er alleen naast. Het stuk vlak voor de finish hoort
  bij de straight van de volgende lap (`across_line`, `SessionEnergy.across`).
- **Terugschakelen bij vol gas** (`energy.downshifts`, `Downshift`): gear omlaag op een straight,
  boven 200 km/h. Komt na het clippunt, terwijl de auto oogst: onder 10.500 rpm krijgt een 2026-motor
  minder brandstofflow (EF = 0,27·N + 165 MJ/h tot 10.500 rpm, daarboven 3000), dus een versnelling
  terug houdt hem op vol vermogen. Teams verschillen (Mercedes wel, Red Bull niet). De gear-sample
  loopt ~0,2 s achter op de rpm (de rpm springt eerst), dus de plek is ~15 m te laat. Rpm zelf
  zegt verder weinig: per versnelling vast (8e ≈ 35 rpm per km/h).
- **Frontend**: widget Energy (LAPS: per straight de geselecteerde laps met zinnen en DOWN; SESSION:
  drivers × straights, kosten, meters of % laps met terugschakelen). Telemetry: kanaal Deploy (lijn in
  de lapkleur; boven nul paars `ers` alleen waar de lap inzet volgens dezelfde regel als de kaart
  (`EnergyLap.deploying`, een masker op het raster van `deploy`, uit `energy.deploying_stretches`) en
  licht amber waar hij clipt (dezelfde stukken als de strookjes in de speed-chart, ook als de lijn net
  boven nul blijft: clipping = bijna geen winst, niet snelheid verliezen); onder nul vol amber
  (oogsten); positief zonder inzet of clipping = alleen de lijn. `ChartSeries.fill` met `FillPart`s
  (kleur, masker, dekking); `UPlotChart` tekent de vulling zelf in de `drawAxes`-hook, dus onder de
  lijnen), instelling
  "Clipping and downshifts (2026)": amberen strookjes van 3 px onderaan de speed-chart (een rij per
  lap, de eerste onderaan, `UPlotChart` `bands`), CLIP in de readout en driehoekjes in de lapkleur
  bovenin de gear-chart (`ticks`). Alleen zonder DRS (2026+), zodat een oude sessie niet al zijn
  telemetrie hoeft te lezen.

- **Inzet op de kaart**: een zoombereik is op de Track map wit. Alleen na een klik op een straight
  in Energy (vanaf 2026) is het stuk van de eerste lap paars waar hij inzet en amber waar hij clipt
  (`zoomPieces`, legenda rechtsonder): de zoom onthoudt waar hij vandaan kwam
  (`cursorBus.setZoom(…, 'energy')`, `useZoomKind`; elke andere zoom wist dat). Nilas wil het niet
  bij elke zoom zien (slepen in een chart, Corners, Report).
- **Sectoren op de kaart** (`/sectors`, `zones.get_sectors`, Track map-instelling "Sectors",
  standaard uit): streepjes waar S1 en S2 eindigen (mediaan over de beste laps van de 5 snelsten:
  de afstand op hun sectortijd als deel van de lap, × de laplengte van de kaart), label S1/S2/S3
  binnen de baan. Monza 2025 Q: 1894 en 3711 m.
- **Zones op de kaart** (`zones.py`, `/zones`, Track map-instellingen "DRS zones (until 2025)" en
  "Straights and clipping (2026)", los van elkaar, standaard **uit**; `/zones` geeft per jaar het een
  of het ander, de kaart toont het als de bijbehorende schakelaar aan staat): een paarse
  streep net buiten de baan (`outwardNormals`: weg van het midden van het circuit). Tot 2025 de
  DRS-zones: waar ≥ 50% van de beste laps van de 8 snelsten de flap open heeft (`drs` is 0/1 in de
  data), ≥ 100 m; een race (en sprint) neemt ze uit Q (SQ), want daar gaat de flap alleen open
  achter een andere auto. Vanaf 2026 de straights van Energy (mediaan begin en eind; begin < 0 =
  vóór de lijn, de kaart knipt dat rond) met amber vanaf de mediaan van `clip_at` als ≥ 50% van de
  schone laps clipt. De officiële straight-mode-zones staan apart (zie "Straight mode"). Met vergeleken laps
  daarbuiten een dun amber rijtje per lap waar die clipte (`/energy?laps=`, eerste lap het dichtst
  bij de baan). Let op: een uitgeschakelde TanStack-query geeft wel de cache van een ander paneel.

## Werkplekken (fase 9)

Twee werkplekken met elk **eigen tabs** (geen modus over dezelfde tabs: een analyse-layout hoort niet
te spelen, een bord niet vol telemetrie). `store/dashboards.ts`: `DashboardTab.workspace` (oude tabs:
de preset beslist, `tabWorkspace`), `actives` per werkplek, `workspace` per venster (`?ws=` in de URL,
anders die van de laatst actieve tab; `merge` in de persist zet oude opslag om). Presets hebben
`workspaces`; het +-menu en het Layout-menu tonen eerst die van de werkplek.
- **Pitwall**: AT CLOCK altijd aan (`atClockOn`/`useAtClockOn` in `store/atClock.ts`), panelen op slot
  (dockview `locked` + `disableDnd`; in de titelbalk alleen (i) en tandwiel, want instellingen
  veranderen de indeling niet; EDIT ontgrendelt +, sluiten, popout en slepen, `editing`),
  geen Views/Layout in de topbalk (Layout wel tijdens EDIT), schermvullend. Preset `pitwall` kiest
  op `window.innerWidth` (< 1700 tabs, ≥ 2400 alles naast elkaar) en de sessie (Gaps alleen in een
  race, anders Live lap); de tower staat op `size: 'fit'` (CSS `zoom` tot 2,4× zodat hij het paneel vult).
- **Analyse**: bij binnenkomst de klok op het einde; preset **Debrief** = Report + Delta,
  Telemetry, kaart, Corners/Race pace; preset **Qualifying** = Bests/Laps/Run timeline, Delta,
  Telemetry, kaart, Mini-sectors/Corners/Energy.
- **Qualifying board** (Pitwall, `quali-board`): tower (fit, met Cut en Pred), kaart met alle auto's
  en Live lap, Clock op de sessieklok (`mode: 'session'`, tijd over), Race control, Run timeline,
  Track line.
- **Release** (widget `release`, `lib/release.ts`, alleen frontend): voor de eerste driver van de
  groep: als hij nu (of over w s) de pit uit gaat, begint zijn push op t + w + zijn typische
  out-lap (pit-uit tot de lijn). Elke auto op de baan (status uit de tower, lap-voortgang uit het
  positiespoor) gaat door op het tempo van zijn lap: push = zijn beste, cool-down (lap na een
  push-lap ≤ 103%) en out-lap = de typische van de sessie; daarna out → push → cool. Conflicten:
  een cool-down vóór hem die hij tijdens zijn lap inhaalt (constant tempo), een push < 2 s achter
  hem, < 0,8 s voor hem. Balk = de komende 2:30 (groen vrij, amber niet). Ook in replay een
  voorspelling; auto's in de garage weet hij niet. Monza 2025 Q3 (16:59:11): vijf auto's op een
  out-lap, VER nu = 6,4 s achter NOR, vrij.
- **Mini-sectors** (widget `minisectors`): `/compare`'s `mini_sectors` als tabel, per mini-sector de
  bochten erin (`circuit.corners` geschaald naar de laplengte), paars de snelste, de rest +gap;
  onderaan lap, LOST (tegen de ideale combinatie) en hoe vaak de snelste. Hover = cursor, klik = zoom.
- **Dashboards per werkplek**: elke werkplek heeft zijn eigen tabs (ook Pitwall: + voor een preset
  of "Duplicate this dashboard", `duplicate` zet de kopie ernaast). Toetsen **1–9** = de n-de tab van
  de werkplek waar je staat (het cijfer staat klein in de tab), ook in de palette.
- **Klok per werkplek** (`features/workspace/useWorkspaceClock.ts`): bij het wisselen wordt de stand
  (t, spelen, live volgen) van de oude werkplek bewaard en die van de nieuwe teruggezet; een nieuwe
  sessie vergeet ze. Een gepauzeerde klok op het einde blijft op het einde als het bereik groeit
  (`clock.atEnd`), zodat Analyse live alles blijft tonen.
- **Tweede scherm**: het icoon naast de schakelaar opent de andere werkplek in een eigen venster
  (`window.open` met `?ws=`); elk venster heeft zijn eigen klok, cursor en zoom. De sessie en de
  laps die met de hand gekozen zijn lopen live mee via een BroadcastChannel (`store/sync.ts`:
  `share`/`onShared`; `toggleLap`/`setLaps`/`replaceLap` en de sessie, een gedeelde keuze zet Follow
  daar uit). Follow (`followTo`) gaat bewust niet mee: elk venster schuift op zijn eigen klok.
- **Report** (`/report`, `reports.py`, widget `report`): de backend zoekt, de frontend schrijft
  (`lib/report.ts`, bochten met `explainCorner`). Elk punt heeft een `ReportAction` (laps, zoom, t);
  een klik zet de laps in de link-groep, zoomt, of zet de klok. Waar de tijd zit: beste laps van de
  tien snelsten tegen de snelste, grootste bochtverlies; laps waarvan de telemetrie > 0,5% langer of
  korter is dan de mediaan vallen eruit (Monza 2026 Q, GAS L17: 110 m te lang door een gat, gaf
  iedereen 1,1 s verlies in T5). Long runs (FP): ≥ 5 schone laps binnen 107% op één set, mediaan,
  zonder brandstofcorrectie. Degradatie: de stintfits van Race pace (≥ 8 laps). Clipping: alleen
  2026. Race-momenten: start (≥ 3 plaatsen), snelste/traagste stop (groen, < 60 s), undercuts (achter
  binnen 3 s, eerst gestopt, de ander ≤ 4 laps later, na beider stops ervoor; op gaps, niet posities),
  SC/VSC/rood.

## Straight mode (fase 11)

Straight mode (2026, vervangt DRS): beide vleugels plat, voor iedereen op elke lap, alleen in de
zones van de FIA; dicht aan het eind van de zone of bij remmen. Bij weinig grip (race control
`LOW GRIP CONDITIONS` tot `NORMAL GRIP CONDITIONS`) alleen de voorvleugel en latere starts.
Overtake mode is iets anders (MGU-K, binnen 1 s bij de detectielijn, `OVERTAKE ENABLED`).
- **Niet in de data**, ook niet in de versnelling: getoetst op 2025 (het DRS-kanaal als waarheid);
  het openen is per lap geen zichtbare sprong, en in 2026 is er geen "uit" om mee te vergelijken.
  Zie ROADMAP fase 11.
- **Bron**: per event het FIA-document "Competition Notes – Circuit Map" (fia.com/documents →
  seizoen → event). `uv run python -m app.sources.fia 2026 18` (of `--all`) zoekt de nieuwste
  kaart (`_v2`), leest de tabel met pypdf (dev-dependency) en schrijft `app/straight_mode.json`
  (in git, per jaar en eventnaam: per zone het activatiepunt normaal en bij weinig grip als
  bocht + meters, plus de overtake-punten als tekst). Varianten: "30m after T11 / Pit Exit",
  "40m before T3 exit", "Exit T18" (= bij de bocht), "T1A-entry", n/a. Klopt het aantal niet
  (de tekst mist soms de tabel: Oostenrijk, Hongarije), dan slaat het script het event over: met
  de hand invullen van de tekening (pagina 2 van de PDF; `sips -s format png` maakt er een
  plaatje van) en `note` erbij. Het script laat zulke events staan als het opnieuw faalt.
- **Op de lap** (`straight_mode.py`, `/straight-mode`): bocht uit `corners.json` geschaald naar de
  gewone laplengte + de meters (±50 m: welk punt van de bocht de FIA bedoelt weten we niet).
  De tabel heeft geen eind: de straight van Energy waar het punt op ligt (of tot 300 m ervoor,
  het punt ligt vaak in de uitgang van de bocht) eindigt waar de meeste laps remmen; eerder als
  de volgende zone begint; een `end` in de JSON (van de tekening) wint: zones die vóór een
  vlakke bocht stoppen (Spa A2 vóór Eau Rouge, A4 vóór T16). Dwarsversnelling werkt daar niet
  voor: Baku's knik T20 en Monza's knik in A3 zitten midden in een zone. Zonder straight in de
  data: 150 m vóór de volgende bocht (`end_source`).
- **Frontend**: Track map "Straight mode zones (2026)" (standaard uit): grijze streep buiten de
  baan, binnen als "Straights and clipping" ook aan staat, label A1… bij het begin, uitleg in de
  `title`; weinig grip op de klok (`useLowGripAtClock`, rendert alleen bij een wissel). Telemetry
  en Delta "Straight mode zones (2026)" (standaard aan, alleen 2026): vlak achter de lijnen
  (`UPlotChart` `zones`, `COLORS.aeroFill`), naam rechts bovenin; weinig grip volgens de start
  van de eerste lap; een zone over de lijn ook aan het eind van de lap.

## Bandensets (fase 10)

`tyres.py`, `/tyre-sets` (per sessie: alle sessies van het weekend tot en met deze), widget Tyre sets.
De data heeft geen setnummers, alleen per lap compound, `fresh_tyre` (nieuw bij het begin van de
stint) en `tyre_life` (leeftijd, loopt door over stints en sessies op dezelfde set). `chain`: een
stint op een nieuwe set = een nieuwe set; een stint op een gebruikte set hoort bij de eerdere set van
die compound met de hoogste leeftijd onder de eerste leeftijd van de stint; geen match = een set die
al gebruikt was (`new_in: null`, punt in de UI). Monza 2025: ALO 13 sets (8 S, 3 M, 2 H) = de
allocatie; PIA eindigt de race op een soft uit Q (4–11). Alleen drivers van deze sessie in de
widget: FP1-rookies rijden op de sets van de vaste driver.

## Speed map (fase 10)

`setups.py`, `/setups`, widget Speed map (`setups`): de beste lap van elke driver (zonder gat in de
telemetrie) op de snelste lap gelegd zoals `/compare`, in bochtsegmenten
(`analysis.corner_segments`); per driver de hoogste snelheid op de lap, de speed trap en de
gemiddelde minimumsnelheid over alle bochten, de langzame (< 150 km/h op de snelste lap) en de
rest. Scatter in SVG met de medianen gestippeld: linksboven weinig luchtweerstand, rechtsonder
veel downforce. Monza 2025 Q: HUL 356 km/h / 180 km/h, PIA 346 / 190.
**Teammates** (`setups.teammates`, `/teammates`, widget `teammates`) gebruikt dezelfde vergelijking
(`setups.best_lap_corners`, gecachet per sessie): per team de snelste eerst, gat op beste lap,
per sector, topsnelheid, de bochtsegmenten met het grootste verschil, en in een race de mediaan
van de schone laps (`strategy.is_clean`). Monza 2025 R: VER–TSU +1,709 (pace +1,01), NOR–PIA
+0,344 maar PIA in pace 0,03 sneller. De box van de widget wordt
altijd gerenderd: `useElementSize` meet anders nooit (de ref verschijnt pas na het laden).

## Weekend (fase 10)

`weekend.py`, `/weekend`, widget Weekend: per sessie van het weekend tot en met deze per driver de
plaats (training en Q op beste lap, race en sprint op de finish: `position` van zijn laatste lap)
en het gat op beste lap; de langste long run uit de trainingen (`reports.long_runs`, meeste laps,
dan de snelste mediaan: een korte run is vaak met weinig brandstof) en het racetempo
(`setups.race_pace`). In de preset Session overview als tab naast de Run timeline. Monza 2025:
VER P6/P4 in FP2/FP3, maar het snelste racetempo (1:22.874).

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
- **Battles** (widget `battles`, `lib/battles.ts`, alleen frontend uit `/race-history`): per paar
  in de volgorde op t het interval op de lijn van de laatste lap van de achterste, de trend
  (interval N laps terug − nu, / N; alleen als alle laps in het venster voor beiden schoon zijn),
  het gemiddelde schone tempo, en laps tot binnen 1 s (ATTACK) en tot erop (CATCH); rood als dat
  vóór de finish is. Negatief interval (een stop bezig) = geen interval. Rekent per passage
  (`crossingsKey`). In de presets Strategy en Pitwall (race).
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
- **Positie**: x, y en z in het archief en live in **decimeters**. De 2026-telemetrie (archief en
  live) heeft speed, throttle, brake, gear, rpm, x/y/z; `drs` is leeg.
- **Telemetrie met een gat**: soms is de afstand van een lap fout (Monza 2026 Q, GAS L17 is 110 m te
  lang). Uitrekken naar de referentie verdeelt dat verkeerd, dus een bochtvergelijking met zo'n lap
  geeft onzin. `analysis.length_off` (> 0,5%, `LENGTH_SLACK`) tegen `sessions.typical_lap_length`
  (mediaan van de beste laps van de 5 snelsten): `/compare` geeft per lap `length` en `length_off`;
  Corners toont dan een melding in plaats van de tabel, Delta "+107 m" achter de lap. Report laat
  ze weg (tegen de mediaan van zijn eigen laps). Een out-lap door de pitstraat kan ook afwijken
  (Monza 2025 R, NOR L47: +41 m).
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
  Energie (2026) heeft eigen tokens: `ers` paars = inzet (Deploy), `clip` amber = clipping of oogsten
  bij vol gas. Al het andere is wit of grijs.
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
  zonder zo'n paneel toont in de klokbalk "No panel here follows the clock" met "Open Pitwall".
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
