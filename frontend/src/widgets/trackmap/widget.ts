import { lazy } from 'react';
import { defineWidget } from '../types';

export type TrackMapConfig = {
  cars: 'laps' | 'all';
  miniSectors: number;
  corners: boolean;
  markers: boolean;
  ghosts: boolean;
  zones: boolean;
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
      'A zoomed range in the charts is highlighted in white on the map (click a straight in ' +
        'Energy). From 2026 the first lap’s stretch is purple where it probably deployed (it ' +
        'gains more than the engine alone could) and amber where it clipped: an estimate.',
      'Distance markers (Shift + drag in a chart, or m) are drawn as a grey band with their note.',
      'With “Cars: all” the map shows every car at the session clock instead (replay). The first ' +
        'time, the telemetry of every lap is downloaded once (about 10 s for a race).',
      'Zones (off by default), purple along the outside of the track: the DRS zones (until 2025; where most of ' +
        'the quickest laps open the flap, in a race those of qualifying) or, from 2026, the ' +
        'straights at full throttle (an estimate: the official straight-mode zones are not in ' +
        'the data). Amber over it: from where most laps of the session start to clip. With ' +
        'compared laps, a thin amber row per lap shows where that lap clipped (the first lap ' +
        'nearest the track).',
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
    zones: false,
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
    { key: 'zones', label: 'DRS zones, or straights and clipping (2026)', kind: 'toggle' },
    { key: 'sectors', label: 'Sectors', kind: 'toggle' },
    { key: 'ghosts', label: 'Pit stop ghosts (all cars)', kind: 'toggle' },
  ],
  followsClock: (config) => config.cars === 'all',
  component: lazy(() => import('./TrackMapWidget').then((m) => ({ default: m.TrackMapWidget }))),
});
