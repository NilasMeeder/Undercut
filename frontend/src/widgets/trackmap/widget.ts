import { lazy } from 'react';
import { defineWidget } from '../types';

export type TrackMapConfig = {
  cars: 'laps' | 'all';
  miniSectors: number;
  corners: boolean;
  markers: boolean;
  ghosts: boolean;
  drs: boolean;
  straights: boolean;
  straightMode: boolean;
  overtake: boolean;
  passes: boolean;
  sectors: boolean;
};

export const trackMapWidget = defineWidget<TrackMapConfig>({
  id: 'trackmap',
  title: 'Track map',
  description: 'Circuit with mini-sector winners and the cursor, or every car at the clock',
  help: {
    summary:
      'The circuit split into equal mini-sectors. Each one is drawn in the colour of the selected ' +
      'lap that was fastest through it. The dots show every lap at the group cursor.',
    watch: [
      'Runs of one colour show where a driver is consistently quicker, for example all the slow corners.',
      'Mini-sectors shorter than ~50 m mostly show noise: telemetry is only sampled at ~4 Hz.',
      'A zoomed range in the charts is highlighted in white on the map. From 2026, after a click ' +
        'on a straight in Energy, the first lap’s stretch is purple where it probably deployed ' +
        '(it gains more than the engine alone could), faint amber where it clipped and amber ' +
        'where it lost speed at full throttle (superclipping): an estimate.',
      'Distance markers (Shift + drag in a chart, or m) are drawn as a grey band with their note.',
      'With “Cars: all” the map shows every car at the session clock instead (replay). The first ' +
        'time, the telemetry of every lap is downloaded once (about 10 s for a race).',
      'DRS zones (off by default, until 2025): a purple stripe along the outside of the track ' +
        'where most of the quickest laps open the flap (in a race those of qualifying). 2026 ' +
        'has no DRS.',
      'Straights and clipping (off by default, 2026): the straights at full throttle as a ' +
        'purple stripe (an estimate: the official straight-mode zones are not in the data), ' +
        'amber over it from where most laps of the session start to clip. With compared laps, a ' +
        'thin amber row per lap shows where that lap clipped, full amber where it lost speed ' +
        '(the first lap nearest the track).',
      'Straight mode zones (off by default, 2026): a grey stripe outside the track (inside when the ' +
        'straights and clipping are on) where the ' +
        'wings may go flat (straight mode replaced DRS: every driver, every lap, no gap needed). ' +
        'The start is the FIA’s activation point from its circuit map (±50 m); the FIA gives no ' +
        'end, so a zone ends where most laps brake, or where the next zone starts. When race ' +
        'control declares low-grip conditions (at the clock), the later low-grip starts. Not in ' +
        'the data: whether a car actually used it is not visible.',
      'Overtake mode (2026): OT D and OT A across the track where the FIA’s map puts the ' +
        'detection and activation line (±50 m). In a race, with all cars, a purple ring round ' +
        'every car that has overtake mode at the clock: within 1 s of the car ahead at its last ' +
        'passage of the detection line (also a lapped car), while race control has it enabled; ' +
        'it lasts until the next passage. Worked out from the positions (4 Hz), not F1’s own ' +
        'timing loop, so a car right on 1 s can be wrong.',
      'Passes (races, with all cars; off by default): every pass for position up to the clock ' +
        'as a dot outside the track in the passer’s colour, the last minute’s big. Passes at ' +
        'the same place stack outward in the order they happened, so a column is a passing ' +
        'place; past five dots the rest is a number (+12). See the Passes panel for what counts.',
      'Sectors (off by default): where sector 1 and 2 end, from the quickest laps’ sector times.',
      'Pit ghosts (all cars): for each driver selected in this link group, a hollow ring where he ' +
        'would be now had he stopped (PIT: green-flag pit loss; SC, dashed: under a safety car), ' +
        'with the position he would rejoin in. It is his own position that many seconds ago.',
    ],
  },
  defaults: {
    cars: 'laps',
    miniSectors: 25,
    corners: true,
    markers: true,
    ghosts: true,
    drs: false,
    straights: false,
    straightMode: false,
    overtake: true,
    passes: false,
    sectors: false,
  },
  settings: [
    {
      key: 'cars',
      label: 'Cars',
      kind: 'choice',
      options: [
        { value: 'laps', label: 'Compared laps at the cursor' },
        { value: 'all', label: 'All cars at the session clock' },
      ],
    },
    {
      key: 'miniSectors',
      label: 'Mini-sectors',
      kind: 'choice',
      options: [
        { value: 10, label: '10' },
        { value: 25, label: '25' },
        { value: 50, label: '50' },
        { value: 100, label: '100' },
      ],
    },
    { key: 'corners', label: 'Corner numbers', kind: 'toggle' },
    { key: 'markers', label: 'Markers', kind: 'toggle' },
    { key: 'drs', label: 'DRS zones (until 2025)', kind: 'toggle' },
    { key: 'straights', label: 'Straights and clipping (2026)', kind: 'toggle' },
    { key: 'straightMode', label: 'Straight mode zones (2026)', kind: 'toggle' },
    { key: 'overtake', label: 'Overtake mode (2026)', kind: 'toggle' },
    { key: 'passes', label: 'Passes (races, all cars)', kind: 'toggle' },
    { key: 'sectors', label: 'Sectors', kind: 'toggle' },
    { key: 'ghosts', label: 'Pit stop ghosts (all cars)', kind: 'toggle' },
  ],
  followsClock: (config) => config.cars === 'all',
  component: lazy(() => import('./TrackMapWidget').then((m) => ({ default: m.TrackMapWidget }))),
});
