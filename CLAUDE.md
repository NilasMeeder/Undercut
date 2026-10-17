# F1 Pitwall Dashboard

Hobbyproject: een geavanceerd F1-analysedashboard in de stijl van een pitwall. Laptijden vergelijken,
mini-sectoren, telemetrie (speed/throttle/brake/gear/RPM/DRS) van meerdere drivers of laps over elkaar,
en een zelf in te delen dashboard met widgets.

**Prioriteit: snelheid en bruikbaarheid > uiterlijk.** Het moet eruitzien als echte pitwall-software,
niet als een AI-dashboard. Zie "Stijl" hieronder. Veel features mag, maar op een goede basis.

Vier modi op dezelfde onderdelen: analyse, replay, strategie en live. Zie `ROADMAP.md` "Visie".

Zie `ROADMAP.md` voor fases en status. Werk de checkboxes daar bij als iets af is.

## Huidige status

Fase 0 t/m 6 zijn af: een docking-dashboard (dockview) met achttien widgets (Laps, Telemetry, Delta,
Track map, Bests, Speed traps, Run timeline, Corners, Race control, Weather, Timing tower, Track line,
Markers, Stints, Gaps, Positions, Race pace, Pit window), link-groepen, gedeelde cursor/zoom,
instellingen (tandwiel) en uitleg (i) per paneel, ⌘K-palette met sneltoetsen, dashboard-tabs met
presets, replay (een sessieklok onderin waar de tower, de kaart met alle auto's, de Track line en race
control op lopen, zie "Replay"), markeringen met notitie en tags plus opgeslagen views als bladwijzer
(zie "Markeringen en views"), en strategie: stints, degradatie, gaps, posities, undercut en
pitverlies-ghosts, allemaal op de sessieklok (zie "Strategie"). Volgende stap: fase 7 (live) of de
open punten, zie ROADMAP.md.

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
backend/app/strategy.py    pure strategie-logica: history (gaps, posities, stints, stops), degradatie-fits,
                           pit window (rejoin, undercut/overcut); strategies.py: per sessie + lru_cache
backend/app/store.py       gebruikersdata in SQLite: markeringen en views (migraties via PRAGMA user_version)
backend/app/schemas.py     Pydantic response-modellen (bron voor de TS-types)
backend/scripts/           export_openapi.py (gebruikt door gen-api)
frontend/src/api/          client.ts (fetch + type-aliassen), queries.ts (TanStack hooks), markers.ts en views.ts
                           (gebruikersdata: queries + mutaties), schema.d.ts (gegenereerd)
frontend/src/store/        selection.ts (sessie), groups.ts (link-groepen + laps per groep), cursor.ts (cursor/zoom-bus,
                           bevriezen), dashboards.ts (tabs met elk een layout), clock.ts (sessieklok),
                           markerEditor.ts (de open markering-editor: markNew, editMarker)
frontend/src/dashboard/    Dashboard.tsx (dockview, tabs, header-acties), layout.ts (presets, opslaan/herstellen),
                           HeaderMenu.tsx (dropdown in de titelbalk), PanelMenus.tsx (uitleg en instellingen)
frontend/src/widgets/      één map per widget: widget.ts (definitie, help, defaults, settings, lazy component)
                           + de component; registry.ts somt ze op; types.ts (defineWidget, resolveConfig);
                           useGroupComparison.ts deelt de compare-data; hooks.ts (useClockDraw, useElementSize);
                           useStrategy.ts (history + klok + cutoff, drivers van een groep, driverkleuren)
frontend/src/components/   chart/UPlotChart.tsx (uPlot gekoppeld aan cursor/zoom), chart/LapChart.tsx (uPlot over laps:
                           SC-banden, klok-lijn, labels, readout), data/bits.tsx (badges, swatches)
frontend/src/lib/          colors.ts (spiegel van de CSS-tokens), format.ts, timing.ts (paars/groen, bests, attempts,
                           lijnstijlen), laps.ts (lap/driver stappen), insights.ts (zinnen voor Corners), table.ts,
                           replay.ts (auto op t interpoleren, klokformaat, pit-ghosts), markers.ts (labels, plaats
                           als tekst), strategy.ts (cutoff, volgorde op t, lap-as, SC-banden)
frontend/src/features/     topbalk: session/ (SessionPicker, GroupBar, useDefaultSelection), commands/ (⌘K en
                           sneltoetsen), dashboards/ (tabs, Layout-menu met presets en export/import),
                           clock/ (ClockBar onderin, useSessionClock), markers/ (MarkerEditor, actions:
                           springen en markeren), views/ (ViewsMenu, openen/opslaan, #view=-links)
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
| **TracingInsights** (`github.com/TracingInsights/<jaar>`) | 2018–2026, per sessie: `session_laptimes.json`, `drivers.json`, `corners.json`, `rcm.json`, `weather.json`, `team_radio.json`, en per driver `<DRV>/<lap>_tel.json` | **Primaire bron.** Gratis (Apache 2.0) via `raw.githubusercontent.com`. Gemaakt met FastF1, al kolom-georiënteerd met distance, x/y/z, acc_x/y/z en DriverAhead. Nieuwe sessies na 15 okt 2026 komen er mogelijk niet meer bij. Zie hun `DATA_REFERENCE.md`. |
| **OpenF1** (`api.openf1.org/v1`) | Laps, sectoren, car_data, location, stints, pit, weer, race control, team radio | **Fallback** voor sessies die nog niet in TracingInsights staan. Historisch (2023+) gratis zonder key, max 3 req/s en 30 req/min. Live alleen betaald. |
| FastF1 | Schema (`get_event_schedule`), en alles als er een F1 TV-token of een fix komt | Nu alleen voor het schema. De bron-laag zo bouwen dat FastF1 later weer kan aansluiten. |
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
hoofdvenster). Tags: vrij, ontdubbeld zonder hoofdletters; suggesties zijn de vaste lijst in
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
  description, help, defaults, settings, component: lazy(...) })` + entry in de registry.
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
