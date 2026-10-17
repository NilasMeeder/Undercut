import { lazy } from 'react';
import { defineWidget } from '../types';

export type PositionsConfig = { drivers: 'all' | 'selected' };

export const positionsWidget = defineWidget<PositionsConfig>({
  id: 'positions',
  title: 'Positions',
  description: 'Lap chart: every driver’s position after each lap, from the grid',
  help: {
    summary:
      'Position at the line after every lap; lap 0 is the starting grid. It follows the session ' +
      'clock, so in a replay the chart grows lap by lap.',
    watch: [
      'Dips of a few places that come back within two laps are pit stops cycling through.',
      'Crossing lines away from the stops are overtakes on track.',
    ],
    controls:
      'Hover for the order at a lap (all lap charts of this link group follow). Drag to zoom ' +
      'laps, double-click to reset. Selected drivers are drawn thicker.',
  },
  defaults: { drivers: 'all' },
  settings: [
    {
      key: 'drivers',
      label: 'Drivers',
      kind: 'choice',
      options: [
        { value: 'all', label: 'All, selected ones highlighted' },
        { value: 'selected', label: 'Only the selected drivers' },
      ],
    },
  ],
  followsClock: true,
  component: lazy(() => import('./PositionsWidget').then((m) => ({ default: m.PositionsWidget }))),
});
