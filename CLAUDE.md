# F1 Pitwall Dashboard

Hobbyproject: een geavanceerd F1-analysedashboard in de stijl van een pitwall. Laptijden vergelijken,
mini-sectoren, telemetrie (speed/throttle/brake/gear/RPM/DRS) van meerdere drivers of laps over elkaar,
en een zelf in te delen dashboard met widgets.

**Prioriteit: snelheid en bruikbaarheid > uiterlijk.** Wel strak en leesbaar: alleen een donker thema met
neutrale grijstinten, geen F1-rood of branding. Kleur alleen voor data (teamkleuren, sectoren, banden).
Geen tijd steken in animaties of marketing-UI.

Zie `ROADMAP.md` voor fases en status. Werk de checkboxes daar bij als iets af is.

## Huidige status

Fase 0 is af: backend met `/api/health` en `/api/seasons/{year}/events`, frontend met sessiekiezer en
kalender. Volgende stap is fase 1 (data-API) in `ROADMAP.md`.

## Architectuur

```
backend/    Python 3.12 + FastAPI + FastF1   → JSON API op :8000
frontend/   Vite + React + TypeScript        → SPA op :5173, praat met /api (proxy)
```

- **Backend** doet al het zware werk: FastF1 laden, cachen, telemetrie resamplen, delta's en
  mini-sectoren berekenen. De frontend rekent zo min mogelijk.
- **Frontend** is een puur client-side dashboard. Geen SSR nodig (canvas-charts, localStorage-layouts).
- Geen auth, geen databaseserver. Opslag is embedded (parquet-bestanden, eventueel DuckDB).
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
| Widget-grid | react-grid-layout | Slepen/resizen, layouts serialiseerbaar naar JSON |
| Server state | TanStack Query | Caching/dedup van API-calls per sessie |
| Client state | Zustand | Geselecteerde sessie/drivers/laps, gedeelde cursor, layouts |

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
backend/app/main.py        FastAPI-app en routes
backend/app/f1data.py      alles wat FastF1 aanraakt (laden, cache, omzetten naar schemas)
backend/app/schemas.py     Pydantic response-modellen (bron voor de TS-types)
backend/scripts/           export_openapi.py (gebruikt door gen-api)
frontend/src/api/          client.ts (fetch + type-aliassen), queries.ts (TanStack hooks), schema.d.ts (gegenereerd)
frontend/src/store/        Zustand stores (selection.ts: jaar/ronde/sessie, persisted)
frontend/src/features/     feature-componenten (session/...)
frontend/src/components/ui shadcn-primitives
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
| Jolpica (Ergast-opvolger) | Uitslagen, standen | Gratis |

Gevolg: de backend krijgt een **data-source laag** (`app/sources/`) waarin elke bron dezelfde interne vorm
levert. Volgorde: lokale opslag → TracingInsights → OpenF1. Een opgehaalde sessie wordt meteen lokaal
opgeslagen (`backend/.cache/`), zodat elke sessie maar één keer van internet komt.
Let op: FastF1's `session.load()` gooit **geen** exception als de bron faalt. Het logt alleen warnings,
en daarna geeft `session.laps` een `DataNotLoadedError`.

**2026-regels:** DRS bestaat niet meer (active aero + overtake mode). In de 2026-data is `drs` leeg
(`null`), en er is geen kanaal voor wingstand of energie-inzet. Het DRS-kanaal dus alleen tonen als er data is.

## Domeinkennis & FastF1-valkuilen

Lees dit voordat je data-code schrijft. Fouten hier geven grafieken die er goed uitzien maar niet kloppen.

- **Cache altijd aan**: `fastf1.Cache.enable_cache("backend/.cache/fastf1")`. Een sessie voor het eerst
  laden duurt 10–60 s; daarna seconden. De frontend moet dus een duidelijke laadstatus tonen.
- **Eigen cache bovenop FastF1**: verwerkte resultaten (resampled telemetrie, mini-sectoren) per sessie
  opslaan (parquet of pickle in `backend/.cache/processed/`) zodat herberekenen niet nodig is.
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
- **Timedelta/NaT**: FastF1 gebruikt pandas `Timedelta`. Converteer in de backend naar seconden
  (`float`, ms-precisie) en NaT naar `null`. Nooit timedelta-strings naar de frontend sturen.
- **Delta-tijd zelf berekenen**: `fastf1.utils.delta_time` is onnauwkeurig (staat ook zo in de docs).
  Methode: beide laps resamplen op een gemeenschappelijk afstandsgrid (bv. elke 5 m), tijd interpoleren,
  delta = t_b(d) − t_a(d).
- **Mini-sectoren**: lap opdelen op afstand (standaard 25 gelijke stukken, configureerbaar), per driver
  de tijd per stuk via interpolatie op het afstandsgrid. Fastest = paars, PB = groen, rest = geel.
- **Track map**: X/Y uit positiedata; rotatie via `session.get_circuit_info().rotation`.
  Corner-nummers ook uit `get_circuit_info().corners`.
- **Teamkleuren**: `fastf1.plotting.get_team_color()` / `get_driver_color()` met de sessie erbij.
  Twee drivers van hetzelfde team: tweede driver gestippeld of lichtere tint.

## UX-principes

- **Geleidelijk meer laten zien:** begin met een rustige layout en laat de gebruiker zelf widgets
  toevoegen. Presets van simpel ("Quali-duel") tot dicht ("Engineer").
- **Elke widget legt zichzelf uit:** een (i)-knop met wat je ziet en waar je op moet letten.
- **Automatische inzichten boven ruwe data:** bv. "NOR wint 0,12 s in T4 door later te remmen". Dat
  maakt het dashboard bruikbaar zonder engineer-kennis.
- **Compacte modus** voor wie veel tegelijk wil zien (kleinere fonts, minder padding).

## API-conventies

- Alles onder `/api/...`. Identificatie van een sessie: `{year}/{event}/{session}` waarbij `event` de
  ronde of naam is en `session` een van `FP1 FP2 FP3 SQ S Q R`.
- **Kolom-georiënteerde JSON** voor telemetrie: `{ "distance": [...], "speed": [...], ... }`,
  niet een array van objecten. Scheelt veel bytes en past direct op uPlot's dataformaat.
- Eenheden: afstand in meters, tijd in seconden (float), snelheid in km/h. In veldnamen geen eenheden,
  wel in de Pydantic-docstring.
- Driver altijd als 3-letter code (`VER`, `NOR`) in API-paden en responses.
- Response-modellen in `backend/app/schemas.py`; frontend-types genereren uit OpenAPI, niet handmatig
  dupliceren.

## Frontend-conventies

- **Eén gedeelde "cursor"** in Zustand (afstand in meters). Hover in een telemetrie-chart → alle charts
  en de track map tonen dezelfde positie. Dit is de kern van het pitwall-gevoel.
- Widgets zijn losse componenten in `frontend/src/widgets/<Naam>/` met een registry
  (`widgets/registry.ts`): id, titel, default grootte, config-schema. Nieuwe widget = nieuw bestand +
  registry-entry, niets anders.
- Widgets lezen de geselecteerde sessie/drivers/laps uit de store; ze halen hun eigen data via
  TanStack Query hooks in `src/api/`.
- Dashboard-layouts opslaan in localStorage als JSON (later export/import naar bestand).
- Alleen donker thema (geen light mode), neutrale zinc-tinten in `src/index.css`. Kleuren voor sectoren: paars `#a855f7`, groen `#22c55e`, geel `#eab308`.
- Performance: telemetrie-arrays nooit in React state die vaak re-rendert; uPlot direct updaten.

## Code-stijl

- Code, identifiers en comments in het Engels; documentatie (CLAUDE.md, ROADMAP.md) in het Nederlands.
- Python: type hints overal, ruff voor lint/format, pure functies voor berekeningen (delta, mini-sectoren)
  zodat ze los te testen zijn.
- TypeScript: strict, geen `any`. Prettier-config in de repo aanhouden.
- Tests vooral op de rekenlogica in de backend (delta, mini-sectoren, resampling). UI-tests alleen
  waar het echt iets oplevert.
