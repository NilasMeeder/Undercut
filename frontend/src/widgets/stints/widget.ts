import { lazy } from 'react';
import { defineWidget } from '../types';

export type StintsConfig = { deg: boolean; stops: boolean };

export const stintsWidget = defineWidget<StintsConfig>({
  id: 'stints',
  title: 'Stints',
  description: 'Tyre strategy: every stint as a bar, with pit stop losses and degradation',
  help: {
    summary:
      'One row per driver in the order at the session clock, one bar per set of tyres from the ' +
      'out-lap to the in-lap. The bar shows the compound, the laps on it and the degradation: ' +
      'seconds per lap the fuel-corrected lap time rises as the set ages (fitted on clean laps). ' +
      'PIT lists the time each stop cost: in-lap plus out-lap against the driver’s pace around it.',
    watch: [
      'A used set (from qualifying) starts with a few laps on it: see the tooltip.',
      'Degradation needs at least 4 clean laps (no pit laps, lap 1, SC or VSC); short stints have none.',
      'A stop that cost much more than the others usually was a slow tyre change.',
      'Stops under a safety car (yellow bands) cost less: the rest of the field drives slowly.',
    ],
    controls: 'Click a row to select that driver’s latest lap in this link group.',
  },
  defaults: { deg: true, stops: true },
  settings: [
    { key: 'deg', label: 'Degradation in the bars', kind: 'toggle' },
    { key: 'stops', label: 'Pit stop losses', kind: 'toggle' },
  ],
  component: lazy(() => import('./StintsWidget').then((m) => ({ default: m.StintsWidget }))),
});
