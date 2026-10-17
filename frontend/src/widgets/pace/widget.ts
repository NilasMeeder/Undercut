import { lazy } from 'react';
import { FUEL_OPTIONS } from '@/lib/strategy';
import { defineWidget } from '../types';

export type PaceConfig = { x: 'lap' | 'age'; fuel: number; fits: boolean; table: boolean };

export const paceWidget = defineWidget<PaceConfig>({
  id: 'pace',
  title: 'Race pace',
  description: 'Lap times per stint with fuel correction and the tyre degradation fit',
  help: {
    summary:
      'The clean laps of the drivers selected in this link group (no pit laps, lap 1, SC or VSC), ' +
      'corrected for fuel: a car gets about 0.03 s quicker per kg it burns, so raw lap times drop ' +
      'over a race even while the tyres wear. The line through each stint is the degradation fit: ' +
      'its slope is how much slower the car gets per lap of tyre age.',
    watch: [
      'Steeper lines wear their tyres faster; at the end of a long stint that is where an undercut comes from.',
      'Against tyre age (setting) stints of different drivers on the same compound line up.',
      'Points far above the line are traffic, a mistake or a battle; the fit leaves them out.',
      'The fits use only laps completed at the session clock, so in a replay they change lap by lap.',
      'NEW is the fitted lap time on a new set (fuel-corrected): the driver’s pace on that compound.',
      'Practice long runs: the fuel load is unknown, so 1.8 kg per lap is assumed. The slopes ' +
        'compare, the lap times only within a stint; the track getting quicker also shows in them.',
    ],
    controls:
      'Select drivers in the Stints, Timing tower or Laps panel of this link group. Hover for the ' +
      'lap times; drag to zoom, double-click to reset.',
  },
  defaults: { x: 'lap', fuel: 0.03, fits: true, table: true },
  settings: [
    {
      key: 'x',
      label: 'Horizontal axis',
      kind: 'choice',
      options: [
        { value: 'lap', label: 'Lap of the race' },
        { value: 'age', label: 'Tyre age' },
      ],
    },
    { key: 'fuel', label: 'Fuel correction', kind: 'choice', options: FUEL_OPTIONS },
    { key: 'fits', label: 'Degradation lines', kind: 'toggle' },
    { key: 'table', label: 'Stint table', kind: 'toggle' },
  ],
  followsClock: true,
  component: lazy(() => import('./PaceWidget').then((m) => ({ default: m.PaceWidget }))),
});
