import { lazy } from 'react';
import { defineWidget } from '../types';

export type TrackMapConfig = {
  cars: 'laps' | 'all';
  miniSectors: number;
  corners: boolean;
  markers: boolean;
  ghosts: boolean;
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
      'A zoomed range in the charts is highlighted in white on the map.',
      'Distance markers (Shift + drag in a chart, or m) are drawn as a grey band with their note.',
      'With “Cars: all” the map shows every car at the session clock instead (replay). The first ' +
        'time, the telemetry of every lap is downloaded once (about 10 s for a race).',
      'Pit ghosts (all cars): for each driver selected in this link group, a hollow ring where he ' +
        'would be now had he stopped (PIT: green-flag pit loss; SC, dashed: under a safety car), ' +
        'with the position he would rejoin in. It is his own position that many seconds ago.',
    ],
  },
  defaults: { cars: 'laps', miniSectors: 25, corners: true, markers: true, ghosts: true },
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
    { key: 'ghosts', label: 'Pit stop ghosts (all cars)', kind: 'toggle' },
  ],
  component: lazy(() => import('./TrackMapWidget').then((m) => ({ default: m.TrackMapWidget }))),
});
