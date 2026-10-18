# Roadmap

Van lege template naar pitwall-dashboard. Elke fase levert iets bruikbaars op; niet doorschuiven naar de
volgende fase voordat de vorige echt werkt.

## Wat er nu is

- Fase 0 af (2026-10-17): de Next.js-template is vervangen door `backend/` (FastAPI + FastF1) en
  `frontend/` (Vite + React 19 + Tailwind 4). De kalender per seizoen werkt, met een sessiekiezer.
- Fase 2 af (2026-10-17): docking-dashboard met laptijden, telemetrie, delta en track map, gedeelde
  cursor/zoom per link-groep, instellingen (tandwiel) en uitleg (i) per paneel, popout naar een tweede
  venster. Getest in headless Chrome op Monza 2025 Q.
- Fase 3 af (2026-10-17): Bests, Speed traps, Run timeline, Corners ("where is the time", met
  verklarende zinnen), Race control en Weather; ⌘K-palette en sneltoetsen; dashboard-tabs, drie
  presets en export/import van layouts.
- Fase 4 af (2026-10-17): sessieklok met klokbalk (afspelen, snelheid, scrubben, track status en laps
  op de balk), Timing tower op t, Track map met alle auto's, Track line, race control volgt de klok,
  preset "Replay". Telemetrie van een hele sessie in één git fetch (race ~8 s), positiespoor op disk.
  Getest in headless Chrome op Monza 2025 Q, R en FP2 (verse download).
- Fase 5 af (2026-10-17): markeringen op afstand (punt of bereik, optioneel per lap) en op sessietijd,
  met notitie en tags, in Telemetry, Delta, Track map, Track line en de klokbalk, plus een Markers-
  widget; opgeslagen views (sessie, laps, zoom, klok, layout) als bladwijzer met `#view=`-links.
  Alles in SQLite (`backend/data/f1dash.db`). Getest in headless Chrome op Monza 2025 Q en R.
- Fase 6 af (2026-10-17): strategie op de sessieklok: Stints (balken, pitverlies, deg per stint), Gaps
  (race history), Positions (lap chart vanaf de grid), Race pace (brandstofgecorrigeerde laptijden met
  degradatie-fits, per lap of bandleeftijd), Pit window (pit nu → rejoin, undercut/overcut met zinnen),
  pitverlies-ghosts (PIT en SC) op de kaart en de Track line, preset "Strategy". Getest in headless
  Chrome op Monza 2025 R, Q en (API) FP2.
- Fase 7 gebouwd (2026-10-18): live via een opname van de F1-feed (recorder met F1 TV-login), elke
  3 s omgezet met FastF1's parsers naar de archiefvorm, posities en telemetrie per lap, SSE naar de
  frontend, klok volgt live met vertraging, LIVE-knop. Getest met de simulator (Monza 2025 R en Q als
  feed); de echte test is de eerste sessie met de F1 TV-login (Austin FP1, vr 23 okt 17:30 UTC).
- Fase 1 grotendeels af (2026-10-17): sessie-, laps-, telemetrie-, circuit-, compare-, race-control- en
  weer-endpoints op TracingInsights-data. Nog open: de OpenF1-fallback en team radio.

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
- [x] Weer- en race-control-endpoints
- [ ] Team radio endpoint (de data staat in TracingInsights)

**Klaar als:** je met curl twee snelste kwalificatielaps kunt vergelijken en de delta klopt met de
officiële gap (±0,02 s). ✅ Monza 2025 Q: NOR +0,077, LEC +0,215 (exact officieel).

## Fase 2 — De basis

Alles waar elke latere widget op leunt. Pas klaar als het goed voelt, niet als het er alleen staat.

- [x] Stijlregels in code: kleur-tokens (achtergrond, lijnen, tekst, semantische kleuren), compacte
      typografie met tabular numerals, paneel-chrome (titelbalk, tabs, tandwiel, sluiten)
- [x] Docking-shell met dockview: panelen toevoegen, splitsen, tabs, sluiten; layout bewaren in localStorage
- [x] Widget-registry: id, titel, standaardgrootte, config, link-groep. Nieuwe widget = één bestand + entry
- [x] Link-groepen: kleurkeuze per paneel (klik op het vierkantje in de tab), gedeelde selectie (sessie, drivers, laps) per groep
- [x] Gedeelde cursor (afstand) en zoom (afstandsbereik), buiten React-render om voor snelheid
- [x] Sessie- en lap-selectie: sessiekiezer in de topbalk, laps kiezen vanuit de laptijdentabel
- [x] Eerste widgets:
  - [x] **Laptijdentabel** per driver: sectoren paars/groen/geel, compound, verwijderde/in/out-laps grijs
  - [x] **Telemetrie-stack** (uPlot): speed, throttle, brake, gear, RPM, DRS, met gedeelde cursor en zoom
  - [x] **Delta-chart**
  - [x] **Track map**: outline, bochten, cursorpositie, mini-sectoren gekleurd per snelste lap
- [x] Preset-layout "Quali-duel" die je met één klik krijgt
- [x] Paneel-instellingen (tandwiel): kanalen aan/uit en resolutie (Telemetry), resolutie (Delta),
      aantal mini-sectoren en bochtnummers (Track map). Bewaard per paneel in de layout
- [x] (i)-uitleg per widget: wat je ziet, waar je op let, bediening
- [x] Popout naar een tweede venster en link-groep wisselen getest: cursor loopt mee tussen vensters,
      knoppen werken in de popout, "terug" zet het paneel op zijn oude plek
- [x] Code splitting: widgets lazy (elk een eigen chunk), react en dockview als vendor-chunks

**Klaar als:** je een Q3-duel kunt analyseren in een zelf ingedeeld scherm, en de cursor soepel over
alle panelen meeloopt.

## Fase 3 — Analyse-widgets

- [x] **Bests**: beste S1/S2/S3/lap per driver met % achterstand en **theoretische beste lap**
- [x] **Run timeline**: kolom per driver, vakje per lap (paars/groen/geel/in pit/out), per Q-segment,
      kleuren zoals ze op het moment zelf waren, cool-down laps grijs
- [x] "Where is the time" (widget Corners): per bocht tijd, rempunt, minimumsnelheid, vol gas en
      topsnelheid t.o.v. de referentie, met zinnen als "NOR loses 0.141 s to VER in T1–2: brakes
      10 m earlier". Segmenten en metingen in `analysis.corner_segments` (backend, getest)
- [x] Speed traps (I1, I2, finish, trap)
- [x] Race control-feed en weer-widget
- [x] Overlay van eerdere laps van dezelfde driver (sneltoets `o`)
- [x] Command palette (⌘K) en sneltoetsen: `[` `]` lap, `,` `.` driver, `o` overlay, `f` cursor
      bevriezen, `z` zoom resetten
- [x] Presets (Quali duel, Engineer, Session overview), meerdere dashboard-tabs, export/import als JSON
- [ ] Mini-sector-tabel (per mini-sector de tijden; de track map kleurt ze nu alleen)
- [ ] Inzichten in de Corners-widget naast de telemetrie tonen (bv. markering in de speed-chart)

## Fase 4 — Replay

- [x] Sessieklok (afspelen, pauzeren, snelheid, scrubben) als bron voor alle widgets, op sessietijd (s).
      Race control (UTC) omrekenen met t0 = `lSD − lST` uit `session_laptimes.json` (zie CLAUDE.md
      "Tijdassen")
- [x] Backend: toestand op tijd t (posities, gaps, laatste laps, tyres, track status)
- [x] **Timing tower** op tijd t (gap, interval, sectoren, laatste lap, banden)
- [x] Track map met alle auto's; **Track Line** (de baan als rechte lijn met auto's erop)
- [x] Race control en track status volgen de klok
- [x] Datavolume: telemetrie van een hele sessie in bulk (git partial clone), positiespoor één keer
      bouwen en lokaal opslaan, laadstatus met voortgang
- [x] Startgrid van Jolpica voor de volgorde vóór de eerste passage (race en sprint)
- [x] Weer volgt de klok (kolom "Clock" met de waarde op t, witte streep in de sparklines)
- [x] Gele sectoren uit race control op de kaart (met alle auto's) en de Track line, per marshal-sector
- [ ] Auto's na de finish nog een uitlooplap tonen (de data stopt nu op de lijn)

## Fase 5 — Markeringen en opgeslagen views

Ontwerp (zie CLAUDE.md "Markeringen en views"): markeringen per sessie, op afstand (optioneel aan
één lap gekoppeld) of op sessietijd (optioneel aan een driver).

- [x] Afstandsbereik of moment markeren met notitie en tags ("lift & coast", "lock-up"): Shift + slepen
      of klikken in een chart, `m`, `⇧M`, het vlaggetje en Shift + slepen op de klokbalk
- [x] Markeringen zichtbaar in charts, track map en Track Line (afstand) en op de klokbalk (tijd)
- [x] Markers-widget: lijst per sessie, filter op tag, klik = erheen (zoom of klok), bewerken, verwijderen
- [x] Opgeslagen views: sessie, laps, zoom, klok en layout als bladwijzer, ook als link (`#view=12`)
- [x] Opslag in een lokaal SQLite-bestand in `backend/data/` (geen databaseserver)
- [ ] Tijdmarkering met driver ook op de kaart en de Track line (ring om die auto zolang hij geldt)
- [ ] Markeringen over sessies heen: die van Q ook in R tonen (zelfde event), zoeken op tag over alles
- [ ] Inzichten van de Corners-widget als (tijdelijke) markering in de charts (kan nu met `DistanceMark`)
- [ ] Markeringen en views mee in de export/import van het Layout-menu
- [x] Klik op een markering in een chart = bewerken/verwijderen, dubbelklik op de klokbalk
- [ ] Hetzelfde op de Track map en de Track line

## Fase 6 — Strategie en race-analyse

Ontwerp: zie CLAUDE.md "Strategie". Backend rekent (history, fits, pit window), de frontend filtert op
de klok; fits en pit window per leiderslap.

- [x] Bandenstrategie (stints als balken), tyre degradation met fit, brandstofcorrectie
- [x] Racetempo, gap-chart, posities per lap
- [x] Pitverlies-ghosts op de track map ("als je nu pit kom je hier uit"), ook op de Track line
- [x] Undercut/overcut-calculator (widget Pit window)
- [ ] Voorspelling naast de werkelijkheid: als beide auto's echt gestopt zijn, de echte gap tonen naast
      wat het pit window voorspelde
- [ ] Compoundtempo uit de trainingen (FP2-long runs van hetzelfde weekend) als start voor het pit
      window, nu is een nog ongebruikte compound "zo snel als een nieuwe set van de huidige"
- [ ] Verkeer na de rejoin meenemen in de undercut (nu alleen als waarschuwing < 1,5 s)
- [ ] Ghost-labels botsen in een dicht pakket (kaart): labelrijen zoals de Track line
- [ ] Gaps: y-zoom (slepen zoomt nu alleen laps) en "gap tot gemiddeld winnaarstempo" als referentie
- [ ] Klik in een lap-chart = klok naar die lap (nu alleen hover)

## Fase 7 — Live

Ontwerp: zie CLAUDE.md "Live". Live is een archief dat groeit: de opname wordt telkens omgezet naar de
bestanden van TracingInsights, dus alle widgets werken zonder wijziging.

- [x] F1 TV-token: via FastF1's eigen login (`fastf1 auth f1tv`), alleen naar livetiming.formula1.com
- [x] Recorder (`make live`): de sessie van nu, opnieuw verbinden, toevoegen aan dezelfde opname
- [x] Omzetten met FastF1's parsers (~1 s per race) naar laps, drivers, race control, weer; generaties
      per sessie zodat caches verlopen
- [x] Posities live (4 Hz, lap-voortgang via projectie op de baan) en telemetrie per afgeronde lap
- [x] SSE (in plaats van websocket) → dezelfde sessieklok: live-rand, volgen met vertraging, LIVE-knop,
      queries verversen per versie, posities aanplakken
- [x] Opnemen = replay: na afloop een laatste omzetting, telemetrie en positiespoor op disk
- [x] Simulator: archiefsessie → feed in tempo, voor testen zonder live sessie
- [ ] Echte test met de F1 TV-login (Austin FP1): opnemen, live volgen, en kijken wat de echte feed
      anders doet dan de simulator (garage/OffTrack, gele vlaggen, Q-delen, rode vlag)
- [ ] Recorder starten vanuit de topbalk (nu `make live` in een terminal)
- [x] Late start (2026-10-18): een opname die halverwege begint geeft vanaf de instap dezelfde laps,
      lapnummers, banden en stints als het archief (`convert.joined_late`, `simulate --join`); getest
      op Monza R, Q en FP2. Ook gevonden: FastF1 vroeg Ergast bij elke omzetting (nu uit), DriverList
      na een uur werd genegeerd, en een klare opname die weer groeide werd nooit meer gelezen
- [ ] Simulator FP2 (rode vlag): bandleeftijd en compound wijken af van het archief, ook zonder late
      start (de simulator stuurt stints anders dan de echte feed, of FastF1's tyre-fix)
- [ ] Strategie bij een late opname: race history en lap-assen gaan uit van laps vanaf 1
- [ ] Tower live direct uit TimingData (gaps/intervallen van F1 zelf), nu uit de laps (tot 3 s later)
- [x] Live telemetrie volgen (2026-10-18): FOLLOW per link-groep (`l`, de laps schuiven per lap mee,
      ook in replay) en de widget Live lap (de lap die bezig is, groeiend, met de live delta tegen de
      vorige of de beste lap). Getest met de simulator (Monza R) en in replay (Monza Q en R)
- [x] Widget Clock (2026-10-18): sessieklok in rode cijfers, live F1's ExtrapolatedClock, anders
      nagerekend uit Q-delen en rode vlaggen; race: racetijd en lap. In de Replay-preset bovenaan rechts
- [x] Clock als digitale klok (2026-10-18): eigen 7-segmentweergave in SVG, standaard de **lokale
      tijd op het circuit** als h:mm:ss (UTC-offset per sessie uit FastF1's schema), knopje
      LOCAL/SESSION wisselt naar de sessieklok; de keuze staat in de paneel-config. Getest in replay
      (Monza R, Q, FP2) en live met de simulator (R en Q)
- [x] Test die een gesimuleerde sessie door `convert.lap_columns` haalt (`test_live_roundtrip.py`, een
      kleine race met pitstop door simulator → FastF1 → omzetting, zonder netwerk). Vangt de
      `_seconds`-fout van 2026-10-18. Nog niet: een kwalificatie (Q-delen, `qs`)
- [ ] Live meters (snelheid, gear, gas/rem van dit moment), als dat nog iets toevoegt naast Live lap
- [ ] Live lap: meerdere drivers tegelijk (nu de eerste driver van de groep)

## Later / backlog

- [ ] **F1 TV-token als optionele bron** (Nilas heeft F1 TV Pro). Login via `uv run python -m fastf1 auth f1tv --authenticate`
      en de FastF1 Companion-extensie. Voorwaarden:
      - het token **alleen** meesturen naar `livetiming.formula1.com`, nooit naar `livetiming-mirror.fastf1.dev` (FastF1's
        `_api.headers` worden voor beide gebruikt, dus niet daar injecteren maar host-specifiek)
      - het token nooit loggen, nooit naar de frontend, nooit in de repo
      - de extensie na het inloggen weer uitzetten
      - het is alleen nodig voor sessies die nog niet in TracingInsights staan

## Ideeën (later, misschien)

- **Automatische analyses** (Nilas, 2026-10-18): na (of tijdens) een sessie zelf analyses laten
  draaien, bv. per driver waar de tijd zit, stints en degradatie samengevat, opvallende momenten
  (snelle stop, undercut gelukt, tempo-omslag) als markeringen of als een verslag

- Remwegen en corner-fases automatisch detecteren uit speed/throttle/brake (braking point, apex, exit)
- Energie-inzet in 2026 inschatten uit speed-traces op straights (er is geen officieel kanaal)
- Team radio afspelen op de tijdlijn (OpenF1 heeft opnames)
- Corner-analyse: min-speed, remwegen, apex-snelheid per bocht vergeleken
- Gear-map / throttle-map op de track
- Long-run vs short-run detectie in vrije trainingen
- Seizoensoverzicht: quali-gaps tussen teammates over een heel jaar
- Dashboard delen als URL (selectie + layout in querystring)
