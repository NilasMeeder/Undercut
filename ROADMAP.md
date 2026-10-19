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
- Fase 8 gebouwd (2026-10-18): energie-inzet 2026 geschat uit de versnelling bij vol gas tegen de
  beste laps per straight (clipping en wat het kost), widget Energy, strookjes in de speed-chart,
  kanaal Deploy en terugschakelen bij vol gas. Getest op Monza 2026 Q en R, Spa Q en Baku Q, en
  live met de simulator (Monza Q).
- Fase 9 gebouwd (2026-10-18): werkplekken Analyse en Pitwall met eigen tabs, Pitwall-bord per
  schermbreedte (op slot, AT CLOCK altijd aan, schermvullend, eigen venster), sessieverslag Report
  in de preset Debrief. Getest in headless Chrome op Monza 2025 R, Q, FP2 en Monza/Spa 2026 Q.
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
- [x] Mini-sector-tabel (fase 10, widget Mini-sectors)
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
- [x] AT CLOCK (2026-10-18): Laps, Bests, Speed traps en Run timeline alleen tot de klok (paars/groen
      zoals toen), schakelaar in de klokbalk (`c`) en per paneel te overschrijven; geselecteerde laps
      die nog niet gereden zijn vaag in de topbalk. Getest op Monza Q (Session overview)
- [ ] AT CLOCK ook voor Telemetry/Delta/Corners (een vage lijn voor een lap die nog niet gereden is)
      en de Markers-lijst

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
- [x] Recorder starten vanuit de topbalk (2026-10-18): REC met status, de sessie van nu of "opnemen
      als hij begint" (`record.py --wait`), stoppen en de laatste logregels; eigen proces, overleeft
      een herstart van de backend
- [x] Late start (2026-10-18): een opname die halverwege begint geeft vanaf de instap dezelfde laps,
      lapnummers, banden en stints als het archief (`convert.joined_late`, `simulate --join`); getest
      op Monza R, Q en FP2. Ook gevonden: FastF1 vroeg Ergast bij elke omzetting (nu uit), DriverList
      na een uur werd genegeerd, en een klare opname die weer groeide werd nooit meer gelezen
- [ ] Simulator FP2 (rode vlag): bandleeftijd en compound wijken af van het archief, ook zonder late
      start (de simulator stuurt stints anders dan de echte feed, of FastF1's tyre-fix)
- [ ] Strategie bij een late opname: race history en lap-assen gaan uit van laps vanaf 1
- [x] Tower live direct uit TimingData (2026-10-18): F1's volgorde, gaps, intervallen en status over
      de tower uit de laps (`live/tower.py`), ook meteen bij een late opname. Getest met de simulator
      (Monza R met `--join`, Q2)
- [x] Tower: F1's mini-sectoren (2026-10-18): `Segments` uit TimingData als streepjes onder de
      sectortijden (paars/groen/geel/pitstraat), live en in de replay van een opname
      (`converted/segments.json`); de simulator verzint ze uit de telemetrie. Getest met de
      simulator (Monza R live en met `--join`, Q als klare opname) en FP2 uit het archief (geen)
- [ ] Na Austin FP1: kloppen de statuscodes, hoeveel segmenten per sector, en wanneer wist F1 ze
      (bij de lijn of bij het eerste segment, zoals de simulator)? Staat er "Unknown segment
      status" in de log?
- [ ] Tower: `Catching` (F1's "loopt in op de auto ervoor"), nu niet gebruikt
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
- [x] Live lap vloeiend (2026-10-18, Nilas): 2 s vooruit gevraagd en per frame afgeknipt op de klok,
      afgeronde lap 3 s vasthouden met de echte eind-delta, lijnen licht gladgestreken. Getest met de
      simulator (Monza R: VER L42 +0.087 aan de lijn = laptijdverschil)

## Fase 8 — Energie (2026)

Ontwerp: zie CLAUDE.md "Energie". Er is geen kanaal voor batterij of inzet; de feed heeft alleen
speed, throttle, brake, gear, RPM en positie. Dus inschatten en eerlijk zeggen dat het een schatting is.

- [x] Ontwerp (2026-10-18): straights = vol gas ≥ 250 m, genoemd naar de bochten; a(v) uit de
      snelheid, gecorrigeerd voor helling; omhullende per straight (per lap de mediaan per bin, over
      de laps het 95e percentiel); bochten op vol gas niet beoordeeld; clipping = vol gas zonder winst
      waar de omhullende nog wint, kost = de omhullende volgen tot de lift/rem
- [x] Backend (pure numpy, 17 tests + 4 API-tests): `/energy?laps=` en `/energy/session`
- [x] Widget Energy (LAPS en SESSION) en strookjes in de speed-chart met CLIP in de readout; Energy
      als tab achter Corners in Engineer
- [x] Getest op Monza 2026 Q en R, Spa Q (Raidillon/Blanchimont, helling), Baku Q (finish op het
      rechte stuk) en live met de simulator (Monza Q: zelfde medianen als het archief)
- [ ] Na Austin FP1: kloppen de getallen uit een echte opname (CarData 4 Hz, zoals de simulator)?
- [ ] AT CLOCK voor Energy: SESSION en de omhullende alleen uit laps tot de klok
- [ ] Slipstream uit de omhullende houden (`DistanceToDriverAhead` staat alleen in het archief)
- [ ] Clipping per lap over een stint/race als lap-chart (waar spaart of oogst een driver, en wanneer)
- [x] Zones op de Track map (2026-10-18, Nilas): paars de DRS-zones (tot 2025, een race uit Q) of
      de straights (2026), amber vanaf waar de sessie meestal clipt, en per vergeleken lap waar hij
      clipte. Getest op Monza 2025 Q en R (Pitwall, alle auto's) en Monza 2026 Q
- [x] Inzet op de kaart (2026-10-18, Nilas): zones standaard uit; een straight aanklikken in
      Energy kleurt het witte zoomstuk paars waar de eerste lap inzet en amber waar hij clipt.
      "Inzet" is nu strenger: meer dan de motor alleen (sessie-omhullende min 280 kW MGU-K, vanaf
      200 km/h), want Deploy > 0 gaf paars uit de Parabolica. Sectoren (S1/S2/S3) als optie op
      de kaart. Getest op Monza 2026 Q (GAS L17: T7→T8, T9→T11) en Monza 2025 Q (DRS als optie)
- [x] Deploy-kanaal in Telemetry dezelfde regel (2026-10-18, Nilas): de lijn blijft % van de
      omhullende, maar paars alleen waar de kaart ook paars is (meer dan de motor alleen); positief
      zonder inzet = lijn zonder vulling. Getest op Monza 2026 Q (GAS L17, RUS L16: zelfde stukken
      als op de kaart)
- [x] Kaart en Deploy (2026-10-18, Nilas): losse schakelaars "DRS zones (until 2025)" en
      "Straights and clipping (2026)"; paars/amber op de kaart alleen na een klik op een straight
      in Energy (niet bij elke zoom); Deploy licht amber boven nul waar de lap clipt (Nilas zag een
      lange clipstrook in de speed-chart terwijl Deploy niet onder nul kwam: clipping is bijna geen
      winst, onder nul is snelheid verliezen), vol amber onder nul. Getest op Monza 2026 Q (GAS L17
      T9→T11) en Monza 2025 Q (DRS 1 en 2)
- [x] Inzet en clippunt nalopen met Nilas (2026-10-19, Monza 2026 Q): paars klopte (eindigt
      ~9 m voor het clippunt), het clippunt niet: het hing aan wat de beste laps deden, dus boven
      de sessie-topsnelheid clipte niemand (RUS L16 →T1 verliest 343 → 336 vol gas: "geen
      clipping") en schoof het tot > 100 m te laat (13 van 97 laps op →T1). Nu per lap: clippunt
      waar de auto zelf ophoudt met winnen, en **superclippen** (Nilas: "zijn rpm begint te
      zakken terwijl hij vol gas is, geleidelijk"): bij vol gas snelheid verliezen, met de rpm
      als toets aan het eind van de run (snelheid zakt maar rpm niet = de lift). Kolom LOST,
      SESSION-cel, licht/vol amber in strookjes en kaart, SUPER in de readout. Getoetst op Monza
      Q en R, Spa Q, Baku Q (zie CLAUDE.md "Energie")
- [ ] Zone-eind en superclippen: zakt de snelheid aan het eind van een straight-mode-zone harder
      omdat de vleugels dichtgaan (Spa Kemmel: −8 m/s² de laatste 150 m)? Pas te zien met
      getekende zone-eindes
- [ ] Clipstukken in Live lap (de lap die bezig is); Nilas: niet standaard
- [ ] Officiële straight-mode-zones per circuit (FIA-documenten, met de hand) naast de geschatte straights
- [x] **Terugschakelen bij vol gas** (2026-10-18, Nilas' vraag of rpm meer zegt): rpm per
      versnelling ligt vast (8e ≈ 35, 7e ≈ 39,4, 6e ≈ 45 rpm per km/h), dus rpm alleen zegt weinig.
      Terugschakelen bij vol gas boven 200 km/h wel: het komt bijna altijd **ná het clippunt**,
      terwijl de auto bij vol gas snelheid verliest (oogsten, "super clipping"), op ~10.150–10.450
      rpm (gemeten over 1 s vóór de wissel; de gear-sample loopt ~0,2 s achter op de rpm). De
      verklaring: in 2026 is de brandstof-energieflow onder 10.500 rpm lager (EF = 0,27·N + 165
      MJ/h, max 3000), dus een versnelling terug houdt de motor op volle flow, en daarmee meer
      vermogen om te oogsten. Monza R: 186 van 189 ná het clippunt, mediaan 20 m vóór de lift;
      Spa Q: ~5 s vastgehouden vanaf ~400 m voor het eind (Kemmel, Bus stop). Per team: Mercedes,
      Audi, Williams, Haas, Alpine en Ferrari (Spa) doen het; Red Bull, Racing Bulls en McLaren
      niet (die laten de rpm zakken tot ~10.000). Nu: kolom DOWN en een zin in Energy, SESSION-cel
      "Downshifts (% of laps)", driehoekjes in de gear-chart
- [x] Kanaal **Deploy** (2026-10-18, geschat) in de Telemetry-stack: a als % van de omhullende
      (minstens 1 m/s²) van die straight, paars erboven, amber eronder (oogsten bij vol gas);
      leeg in snelle bochten. Clipstrookjes in de speed-chart zijn nu amber (Nilas: deploy paars,
      clipping een eigen kleur)

## Fase 9 — Twee werkplekken: Analyse en Pitwall

Nilas (2026-10-18): een duidelijkere scheiding tussen echte analyse na een sessie en een pitwall-bord
voor live of om voor de lol terug te kijken.

Ontwerp (2026-10-18):
- **Een werkplek heeft eigen tabs**, geen modus over dezelfde tabs: een analyse-layout hoort niet
  te spelen en een bord niet vol telemetrie te staan. `DashboardTab.workspace`, per werkplek een
  actieve tab. Bestaande tabs: preset `replay` → Pitwall, de rest → Analyse. Elke werkplek houdt
  minstens één tab.
- **Wisselen** links in de topbalk (ANALYSIS | PITWALL, sneltoets `w`). De keuze is per venster
  (`?ws=pitwall` in de URL, anders de laatste), zodat een tweede venster op een tweede scherm
  Pitwall kan zijn terwijl het eerste Analyse blijft. Elk venster heeft toch al zijn eigen klok.
- **Klok per werkplek**: Pitwall houdt zijn eigen stand (en speelt door); Analyse springt bij
  binnenkomst naar het einde (een keer, daarna mag je scrubben). Live blijft een klok die op het
  einde staat daar staan als er data bijkomt.
- **Pitwall**: AT CLOCK altijd aan (de schakelaar verdwijnt), panelen op slot (niet slepen, geen
  +/tandwiel/(i) in de titelbalken; knop EDIT ontgrendelt), topbalk zonder groepen, views en
  layout-menu; knoppen voor schermvullend en "open in een nieuw venster". Presets: **Pitwall**
  (nieuw: tower groot, kaart met alle auto's, Track line, Clock, race control, Gaps, Live lap) met
  een indeling naar schermbreedte (smal < 1700 px, normaal, breed ≥ 2400 px), Replay en Strategy.
- **Analyse**: presets Quali duel, Engineer, Session overview, Strategy en **Debrief** (nieuw:
  Report naast Delta, Telemetry en de kaart). **Report** (sessieverslag, `/report`): de backend
  zoekt de punten, de frontend maakt er zinnen van; klik = laps in de groep zetten (en zoomen op
  de bocht/straight) of de klok naar het moment. Onderdelen: waar de tijd zit (beste lap per
  driver tegen de snelste, grootste bochtverlies), long runs tegen short runs (FP), degradatie per
  compound en de uitschieters, clipping (2026, uit Energy), opvallende momenten in een race
  (snelste/traagste stop, posities gewonnen in lap 1, undercuts die lukten, SC/rode vlag).

- [x] Werkplekken (2026-10-18): eigen tabs, wisselen in de topbalk (`w`), per venster (`?ws=`),
      klok per werkplek. Getest in headless Chrome (Monza 2025 R: Pitwall op lap 22, `w` → Analyse
      op 53/53, terug → lap 22)
- [x] Pitwall (2026-10-18): preset per schermbreedte (1440, 1920, 2560 getest), op slot met EDIT,
      AT CLOCK altijd aan, schermvullend, nieuw venster; tower-instelling "Size: fill the panel"
- [x] Analyse (2026-10-18): klok op het einde, preset Debrief
- [x] Report (2026-10-18, sessieverslag, `/report`) met klik = vergelijking openen (laps, zoom of
      klok). Getest op Monza 2025 R, Q en FP2 en Monza/Spa 2026 Q; 5 tests op de pure logica, 1 API-test
- [ ] Report: AT CLOCK (tijdens een live sessie: het verslag tot nu), en markeringen voor de momenten
- [ ] Report: meer momenten (tempo-omslag, snelle lap na de stop, verkeer), long runs met brandstof
      als het weekendschema het aantal laps zegt
- [x] Corners/Delta (2026-10-18): een lap met een gat in de telemetrie (lengte > 0,5% anders dan een
      normale lap van de sessie) meldt dat in plaats van een onzin-verlies te tonen. Getest op Monza
      2026 Q (GAS L17: +107 m)
- [x] Meerdere Pitwall-borden snel wisselen (2026-10-18, Nilas): toetsen 1–9 per werkplek (cijfer in
      de tab), "Duplicate this dashboard" om een variant te maken. Getest in Pitwall (Monza 2025 R)
- [ ] Presets naar schermgrootte ook voor Analyse (nu alleen Pitwall)
- [x] Tweede venster (2026-10-18): sessie en met de hand gekozen laps lopen mee tussen vensters
      (BroadcastChannel); klok, cursor, zoom en Follow blijven per venster. Getest met twee vensters
      (Analyse kiest LEC → Pitwall toont hem; Pitwall → FP2 → Analyse ook)
- [ ] Tweede venster: "klok hierheen" ook in het andere venster (bv. een klik in Report), als optie

## Fase 10 — Meer voor de engineer en de analist

Nilas (2026-10-18): "zoveel mogelijk features erin pompen". Volgorde: eerst wat Q live nodig heeft
(Austin FP1 op vr 23 okt), dan de analyse-tools.

- [x] Pitwall op slot: tandwiel en (i) blijven zichtbaar, EDIT alleen voor de indeling (2026-10-18)
- [x] Q-afvallijn in de tower met gap tot de cut (kolom Cut, cut-tijd in de kop; de lijn zelf
      bestond al). Getest op Monza 2025 Q2
- [x] Voorspelde laptijd van de lap die bezig is (beste lap + delta tot nu), kolom Pred in de tower met
      de positie die het geeft (`/predictions`). Getest op Monza 2025 Q (NOR L20: 95% → 1:18.862,
      werkelijk 1:18.869; Q2: NOR P11 → 1:19.420 P9)
- [x] Voorspelde laptijd ook in Live lap ("→ 1:18.582" naast de delta, vanaf 300 m)
- [x] Presets Qualifying (Analyse) en Qualifying board (Pitwall) (2026-10-18). Getest op Monza 2025 Q
- [x] Widget Mini-sectors (2026-10-18): per mini-sector de vergeleken laps, ideaal, LOST. Getest op
      Monza 2025 Q (VER L17 tegen NOR L20: 14/25 tegen 11/25)
- [x] Bandensets per weekend (2026-10-18, widget Tyre sets, `/tyre-sets`): sets aan elkaar geregen op
      leeftijd. Getest op Monza 2025 Q en R
- [ ] Bandensets: FP1-rookies aan de vaste driver koppelen (zelfde auto)
- [x] Topsnelheid tegen bochtsnelheid (2026-10-18, widget Speed map, `/setups`). Getest op Monza 2025 Q
- [ ] Speed map: labels die botsen uit elkaar schuiven
- [x] Teamgenoten naast elkaar (2026-10-18, widget Teammates, `/teammates`). Getest op Monza 2025 R
- [x] Racetrend (2026-10-18, widget Battles): interval, trend over 3/5 laps, tempo, laps tot binnen 1 s
      en tot erop. Getest op Monza 2025 R (lap 22: HAM op RUS +0,128 s/lap, binnen 1 s over 8 laps)
- [x] Weekendoverzicht (2026-10-18, widget Weekend, `/weekend`): plaatsen per sessie, langste long run,
      racetempo. Getest op Monza 2025 R
- [x] Q-releasemoment (2026-10-18, widget Release in het Qualifying board): verkeer op de push-lap als
      hij nu of over w s gaat, eerste vrije moment. Getest op Monza 2025 Q3
- [ ] Release: het einde van de sessie meenemen (op tijd over de lijn), en kalibreren op Austin

## Fase 11 — Straight mode (2026)

Nilas (2026-10-18): in 2026 vervangt active aero de DRS; op aangewezen stukken mag de auto in
"straight mode" (vleugels plat, minder luchtweerstand). Dat willen we kunnen zien. Eerst uitzoeken,
dan pas bouwen.

- [x] Uitzoeken: de regels (2026-10-18). Sporting B7.1 ("Driver Adjustable Bodywork"): straight
      mode = beide vleugels plat; de driver zet hem aan met een knop als de ECU het toestaat, alleen
      helemaal binnen een Activation Zone; dicht aan het eind van de zone (en volgens de pers bij
      remmen), wisselen ≤ 400 ms. Iedereen, elke lap, geen gat-regel, ook in Q. Niet van de grid
      naar T1 (afspraak teams, feb 2026). Weinig grip (regen): de race director staat alleen
      "partial" toe (voorvleugel) in eigen Low Grip-zones, die later beginnen. Overtake mode (B7.2)
      is iets anders: extra MGU-K-vermogen, binnen 1 s bij de detectielijn, activatie erna, alleen
      in de race; race control zegt `OVERTAKE ENABLED/DISABLED` (de opvolger van `DRS ENABLED`).
      **Zones**: per event het FIA-document "Competition Notes – Circuit Map"
      (fia.com/documents → seizoen 2026 → event): per zone A1–A5 het activatiepunt als "30m after
      T11", normaal en low grip, plus overtake-detectie en -activatie; **geen eindpunten** (die
      staan alleen getekend). De tekst is met pypdf uit de PDF te halen. Monza: A1 30 m na T11,
      A2 70 m na T3, A3 170 m na T7, A4 130 m na T10. Monaco heeft geen zones (< 3 s).
- [x] Uitzoeken: de data. Niets. `drs` is in alle 2026-telemetrie 0 (FastF1 #861: F1 heeft aero en
      ERS na de wintertests uit de feed gehaald). Race control: geen straight-mode-berichten, wel
      `OVERTAKE ENABLED/DISABLED` en `LOW GRIP CONDITIONS` / `NORMAL GRIP CONDITIONS`. Live: geen
      echte opname om in te kijken (de simulator maakt alleen de 6 bekende kanalen); de recorder
      bewaart de ruwe feed, dus een nieuw kanaal of topic in Austin valt achteraf te vinden.
- [x] Uitzoeken: de telemetrie. Niet betrouwbaar te zien. Toets op 2025 (DRS-kanaal als
      waarheid): DRS open geeft in de race +0,3–0,5 m/s² bij 280 km/h tegen dicht, maar het
      openen zelf is per lap geen zichtbare sprong in a. In 2026 is er geen "uit" om mee te
      vergelijken (iedereen elke lap in dezelfde zones), en het activatiepunt ligt in de uitgang
      van een bocht, waar grip, inzet en schakelen de versnelling bepalen. Wel vaste sprongen
      (Monza −116 m, Zandvoort −205 m, bij alle teams) maar die liggen niet op de FIA-punten
      (Monza A1 ligt ~470 m eerder): waarschijnlijk inzet. Lap 1 (geen straight mode) vergelijken
      lukt niet: daar zet iedereen vol in en rijdt in de slipstream.
- [x] Gekozen (Nilas, optie A): de zones van de FIA per event, uit de kaart gelezen en nagekeken
- [x] `app/sources/fia.py`: haalt de kaart van fia.com, leest de tabel (pypdf) en schrijft
      `app/straight_mode.json` (in git). 2026 t/m Singapore staat erin; Oostenrijk en Hongarije
      met de hand van de tekening (de tekst mist de tabel); Spa A2 en A4 met een eind van de
      tekening (vóór Eau Rouge en T16)
- [x] `/straight-mode`: per zone begin (FIA-punt), eind (remmen, de volgende zone, de tekening of
      geschat) en het begin bij weinig grip; perioden van weinig grip uit race control
- [x] Track map "Straight mode zones (2026)" (grijze streep, A1…; bij weinig grip op de klok de
      latere starts), band achter de lijnen in Telemetry en Delta (standaard aan, alleen 2026)
- [ ] Austin (ronde 18): de kaart komt meestal do/vr. Dan `uv run python -m app.sources.fia 2026 18`,
      nakijken tegen de tekening (bochtnummers, een zone die vóór een vlakke bocht stopt: `end`
      met de hand), committen. Daarna Mexico, São Paulo, Las Vegas, Qatar, Abu Dhabi net zo
- [ ] Na Austin FP1: in de ruwe opname kijken of er een nieuw CarData-kanaal of topic is (aero,
      ERS) en of race control iets over straight mode zegt
- [ ] Weinig grip in de UI nog niet gezien: Zandvoort R had het alleen vóór de start (buiten de
      tijdlijn). Bij een natte sessie nakijken
- [ ] Optie B (overtake mode) staat nu in fase 12 (detectie- en activatielijn uit dezelfde kaart, ENABLED/
      DISABLED uit race control, wie binnen 1 s zit bij de detectielijn)

## Fase 12 — Pitwall: delta, overtake mode en eigen presets

Nilas (2026-10-19): optie B uit fase 11 (overtake mode) en de delta in cijfers; daarnaast zijn eigen
qualifying-layout voor Pitwall (screenshot in `~/Projecten/f1dash/screenshots`) en zelf presets maken.

- [x] Widget **Live delta** (2026-10-19): de live delta als groot getal, het gat naar de auto ervoor
      erboven en erachter eronder (kleiner), grijs als er geen auto is (P1, laatste); groeit mee met
      het paneel zoals de klok. Achterliggen is geel, zoals in Live lap (oranje/amber is clipping).
      Getest in replay (Monza 2025 Q3: VER L17 −0.073 tegen L14, LEC 0.084 erachter)
- [x] Qualifying board volgens Nilas' screenshot (2026-10-19): tower + Corners, kaart + Live lap,
      klok (sessie, lokale tijd als tab), Race control, Release, Track line + Weather; maten als deel
      van het scherm. Getest op 1512×900 en 2560×1400 (Monza 2025 Q3)
- [x] Eigen presets (2026-10-19): "Save this dashboard as a preset…" in het +-menu, bovenaan in
      + en Layout in beide werkplekken (verwijderen met het kruisje), "Empty dashboard" om zelf te
      vullen (EDIT gaat aan), presets mee in export/import. Getest in Pitwall (opslaan, nieuw
      dashboard eruit met dezelfde 11 panelen, leeg blijft leeg na herladen, verwijderen)
- [x] Overtake mode (optie B, 2026-10-19): detectie- en activatielijn uit de FIA-kaart (alle
      kaarten t/m Singapore opnieuw ingelezen; Oostenrijk en Hongarije met de hand), ENABLED/
      DISABLED uit race control, wie binnen 1 s zit bij de detectielijn (uit het positiespoor).
      OT D/OT A en paarse ringen op de kaart, kolom OT in de tower, OT in Live delta. Getest op
      Monza 2026 R (lap 15: RUS kreeg OT 0,63 s achter VER en ging erlangs) en Monaco R. Ook
      gevonden: Monaco R had `'None'` in x/y, waardoor `/compare` en het positiespoor faalden
- [x] Overtake mode in de analyse (2026-10-19): OT D/OT A als paarse lijnen in Telemetry en Delta
      (races en sprints), kolom OT in Battles. Getest op Monza 2026 R (lap 9: dezelfde OT-auto's in
      Battles als in de tower)
- [x] Race board (2026-10-19): Pitwall-preset `race-board`: tower + Battles, kaart + Gaps
      (Positions, Live lap), klok, Live delta, Race control, Pit window (Stints), Track line +
      Weather. Getest op 1512×900 en 2560×1400 (Monza 2026 R)
- [x] Live delta: de gaten ervoor en erachter in races elk frame uit het positiespoor (2026-10-19,
      Nilas: "de delta van iemand achter of voor is statisch"; de tower verandert alleen bij een
      timinglijn). Monza 2025 R lap 17: VER 4.456 → 4.539, PIA 6.100 → 6.021 in 8 s
- [ ] Na Austin: klopt de 1 s uit het positiespoor met wat F1 doet (een opname heeft geen OT-kanaal,
      maar de race control en de inhaalacties wel)?

## Fase 13 — Meer voor de race en de analyse

Nilas (2026-10-19): "ja allemaal heel nice, vooral ook baanevolutie". Volgorde: baanevolutie eerst,
dan wat in Austin al helpt (race), dan de analyse en de rest.

- [x] **Baanevolutie** (2026-10-19, `evolution.py`, `/track-evolution`, widget Track evolution):
      per push-lap niveau van de driver + band + baan(t), baan als gladde curve (knopen per 10 min,
      Huber). Monza 2025 Q +0,94 s, 2026 Q +0,90 s (ANT's Q2-lap was op de baan van het eind
      1:21.770 waard, sneller dan GAS' pole), Zandvoort/Baku 2026 ~2 s. Alleen Q/SQ: in FP1/FP2
      lijkt de baan aan het eind langzamer (long runs, brandstof staat niet in de data), ook met
      alleen de snelste lap per run
- [x] **Penalty tracker** (2026-10-19, `stewards.py`, `/stewards`, widget Stewards, tab naast Race
      control in het race board): deleted laps (strikes), zwart-wit, incidenten van NOTED tot het
      besluit, straffen tot ze uitgezeten zijn. Getest op alle berichten van 2025–2026 (580
      incidenten, elke straf aan een incident, elke PENALTY SERVED gevonden) en in replay (Monza
      2025 R lap 33: OCO +5 s open, ANT B/W na 3, SAI reprimande)
- [x] **Inhaalacties** (2026-10-19, `passes.py`, `/passes`, widget Passes, kaartlaag "Passes"):
      uit het positiespoor, van ≥ 25 m achter naar ≥ 25 m voor, elk 2 s; zonder pitstops, start en
      staande herstarts, SC/rood/formatie (lap > 120% mediaan), stilgevallen auto's, lapping.
      Monza 2025 R 33 (T1 18, T4 9), Monza 2026 R 369 (283 met OT, jojo bij Roggia). Getest in
      replay (race board, lap 27: 20 passes, ALB +7). Kaartlaag (2026-10-19): passes op dezelfde
      plek stapelen naar buiten (een kolom = een inhaalplek), na vijf een getal; nagekeken op Monza
      2025 R en 2026 R (T4 +75, de jojo) op 1512×900 en 2560×1400
- [x] **Meldingen op het bord** (2026-10-19, `lib/alerts.ts`, `features/alerts/`): toasts in Pitwall
      voor SC/VSC/rood en groen, snelste lap, pitstops (bij pit-uit: tijd in de lane, banden),
      stewards (genoteerd, onderzoek, straf, uitgezeten, zwart-wit), deleted laps, gat < 1 s, OT en
      passes; die laatste vier standaard alleen voor de drivers in de link-groepen. Bel in de topbalk.
      Getest in replay: Monza 2025 R (VER PIT L37 24,4 s M → H, LEC snelste lap), Q (NOR 1:18.869,
      VER 1:18.792)
- [x] **Live lap voor meerdere drivers** (2026-10-19): instelling Drivers (standaard alle drivers
      van de groep, max 4; of alleen de eerste), elk zijn lap tot de klok op één afstandsas met een
      eigen delta en "→" per regel; met één driver de referentielap gestippeld zoals eerst. Getest
      in het quali board (Monza 2025 Q3: VER L17 en NOR L20 tegelijk)
- [x] **Corners live** (2026-10-19, `progress.corners_in_progress`, `/corners-progress`, widget
      Corners live, tab naast Corners in het quali board): de bochtsegmenten van de referentielap
      (vorige of beste, zoals Live lap), elke bocht ingevuld zodra de auto erdoor is, de laatste
      uitgelegd; na de lijn blijft de hele lap staan tot de eerste bocht van de volgende. Monza
      2025 Q, VER L17 tegen L14: bochten samen −0.133, laptijd −0.131
- [x] **Voorspelde einduitslag** (2026-10-19, `strategy.forecast`, `/forecast`, widget Forecast,
      tab in het race board en Strategy): elke auto vanaf zijn laatste lijn op zijn stintfit
      (degradatie ≥ 0, brandstof), de stop die hij nog moet maken (één droge compound) met het
      pitverlies, aangenomen halverwege; in de pit nu: de rest van het verlies op de out-lap.
      Volgorde, gaten, en waar het gat nul wordt (PASSES). Monza 2025 R tegen de uitslag: gemiddeld
      2,8 plaatsen ernaast op lap 25, 1,7 op lap 35 (top 6 goed), 0,8 op lap 48. Eerst gekozen:
      de snelste stoplap, maar met een rechte lijn per set is dat altijd een uiterste
- [x] **Safety car-calculator** (2026-10-19, `strategy.pit_calculator`, `/pit-calculator`, widget
      Safety car, tab in het race board): per auto de rejoin als hij nu alleen stopt met het
      pitverlies onder SC of VSC (Auto: de track status op de klok; groen = "IF SAFETY CAR NOW"),
      plaatsen verloren (FREE), dezelfde stop onder groen, wie nog moet stoppen en wie al in de
      pit is. Getest op Monza 2026 R lap 3 (SC: iedereen achteraan, RUS al in de pit) en Monza 2025
      R lap 25 (VER zou P3 worden)
- [x] **Remwegen en bochtfases** (2026-10-19, `lib/phases.ts`, widget Corner phases, tab in de
      presets Qualifying en Engineer): per bocht per lap een strookje (remmen, rollen, deels gas, vol
      gas, apex) van vlak voor het eerste rempunt tot na vol gas, en de tweede lap tegen de eerste:
      rempunt, meters op de rem, apexsnelheid, vol gas. Alleen frontend, uit `/compare`. Getest op
      Monza 2025 Q, VER L17 tegen NOR L20
- [x] **Gear- en throttle-map** op de baan (2026-10-19, `lib/trackColour.ts`, Track map
      SECTORS/SPEED/THROTTLE/GEAR linksboven of "Colour the track by"): de eerste vergeleken lap
      op de baan in zijn eigen kleur met dekking per niveau (speed in 6 banden over de laps,
      throttle als Corner phases, gear 1–8), de andere laps (max 4) als rijtjes buiten de baan;
      GEAR zet de laagste versnelling per bocht op de baan. Monza 2025 Q, VER L17 / NOR L20: T1–2 2,
      T4–5 3, Lesmo 5, Ascari 5, Parabolica 6 / 5
- [x] **Long runs in FP** (2026-10-19, `longruns.py`, `/long-runs?until=&fuel=&weekend=`, widget
      Long runs, tab naast Weekend in Session overview): ≥ 5 laps at pace (schoon, ≤ 107%) op
      één set, een run stopt bij 2 trage laps op rij en moet voor ≥ 60% uit laps at pace bestaan
      (push–cool–push is geen long run); per compound de snelste mediaan eerst met het gat, DEG =
      helling + aangenomen verbranding (1,8 kg/lap), een lijntje per run, en de runs van de
      groep lap voor lap. Standaard ook de trainingen ervoor. `reports.long_runs` (Report,
      Weekend) gebruikt dezelfde herkenning. Monza 2025 FP2: NOR M 11 laps 1:23.616, VER +0.072,
      RUS snelste op hard 1:24.016; FP1 hield 2 runs over (ARO's push-laps vielen af)
- [ ] **Starts**: posities en snelheid in de eerste 500 m uit het positiespoor
- [ ] **Team radio** op de tijdlijn (OpenF1)
- [ ] **Dashboard delen als URL**
- [ ] **Seizoensoverzicht**: quali-gaps tussen teamgenoten over het jaar

## Later / backlog

- [ ] **F1 TV-token als optionele bron** (Nilas heeft F1 TV Pro). Login via `uv run python -m fastf1 auth f1tv --authenticate`
      en de FastF1 Companion-extensie. Voorwaarden:
      - het token **alleen** meesturen naar `livetiming.formula1.com`, nooit naar `livetiming-mirror.fastf1.dev` (FastF1's
        `_api.headers` worden voor beide gebruikt, dus niet daar injecteren maar host-specifiek)
      - het token nooit loggen, nooit naar de frontend, nooit in de repo
      - de extensie na het inloggen weer uitzetten
      - het is alleen nodig voor sessies die nog niet in TracingInsights staan

## Ideeën (later, misschien)

- **Corners live** (Nilas, 2026-10-18): Corners ook als live view, zoals Live lap: de bochten van
  de lap die nu bezig is vergeleken met de beste of de vorige lap (keuze, zoals de referentie van
  Live lap), per bocht bijgewerkt zodra de auto erdoor is

- **Automatische analyses** (Nilas, 2026-10-18): na (of tijdens) een sessie zelf analyses laten
  draaien, bv. per driver waar de tijd zit, stints en degradatie samengevat, opvallende momenten
  (snelle stop, undercut gelukt, tempo-omslag) als markeringen of als een verslag

- **Presets naar schermgrootte** (Nilas, 2026-10-18): op een groot scherm (curved monitor thuis)
  meer panelen in de presets dan op de MacBook. Pitwall doet dit sinds fase 9 (`window.innerWidth`);
  de analyse-presets nog niet

- Remwegen en corner-fases automatisch detecteren uit speed/throttle/brake (braking point, apex, exit)
- Team radio afspelen op de tijdlijn (OpenF1 heeft opnames)
- Corner-analyse: min-speed, remwegen, apex-snelheid per bocht vergeleken
- Gear-map / throttle-map op de track
- Long-run vs short-run detectie in vrije trainingen
- Seizoensoverzicht: quali-gaps tussen teammates over een heel jaar
- Dashboard delen als URL (selectie + layout in querystring)
