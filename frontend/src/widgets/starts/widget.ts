import { lazy } from 'react';
import { defineWidget } from '../types';

export type StartsConfig = { chart: boolean };

export const startsWidget = defineWidget<StartsConfig>({
  id: 'starts',
  title: 'Starts',
  description: 'Race: the first 500 m, places at every 100 m from the grid, launch and top speed',
  help: {
    summary:
      'The race start from each car’s first-lap telemetry. The chart runs from the grid through ' +
      'points 100 to 500 m past the pole sitter’s grid slot (the order in which the cars passed ' +
      'each one) to the end of lap 1. The table: the place at 500 m and what it gained on the ' +
      'grid, the gap there, the top speed so far and the time to 100 and 200 km/h.',
    watch: [
      'The grid slot comes from where the car stood before it moved (its x/y on the circuit), ' +
        'about 8 m a place; distances after that from its own speed, good to a few metres.',
      'Telemetry is ~4 Hz, so every time here is ±0.25 s: a reaction time is not in it, and ' +
        'two cars side by side at a checkpoint can come out either way.',
      'A slow 0–100 with a normal 0–200 is wheelspin or a bog-down off the line; a slow 0–200 ' +
        'is traction or being boxed in.',
      'Pit-lane starters are not timed (another line to the checkpoints); a car whose first lap ' +
        'has no car data in the archive is left out of the order.',
      'In a replay the chart and the table fill in as the clock passes each point.',
      'A standing restart after a red flag (RESTART) is measured the same way: its lights out ' +
        'is where the field moved off together (less the reaction at the start), its grid the ' +
        'order the cars stood in, and the last column the place at the end of the first lap ' +
        'after it. AUTO shows the last start the clock has reached.',
    ],
    controls:
      'Click a driver to compare his first lap in this link group (Telemetry then shows the ' +
      'start). Drivers selected in the group are drawn strong in the chart.',
  },
  defaults: { chart: true },
  settings: [{ key: 'chart', label: 'Places chart', kind: 'toggle' }],
  followsClock: true,
  component: lazy(() => import('./StartsWidget').then((m) => ({ default: m.StartsWidget }))),
});
