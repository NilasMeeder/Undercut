import { lazy } from 'react';
import { defineWidget } from '../types';

export type GapsConfig = { reference: 'leader' | 'driver'; drivers: 'all' | 'selected' };

export const gapsWidget = defineWidget<GapsConfig>({
  id: 'gaps',
  title: 'Gaps',
  description: 'Race history: every car’s gap to the leader (or a driver) lap by lap',
  help: {
    summary:
      'The gap at the line after every lap, to the car that completed that lap first, or to the ' +
      'first selected driver of this link group. Lines that go down lose time; a step down of ' +
      '20+ s is a pit stop. It follows the session clock: laps after it are not drawn yet.',
    watch: [
      'Two lines converging: the car behind is catching; the slope is the pace difference per lap.',
      'Undercut: after both stopped, compare the gap with the one before the first stop.',
      'Safety car and VSC periods are bands: gaps close up under SC, so a stop costs less there.',
      'Lapped cars run off the bottom of the chart.',
    ],
    controls:
      'Hover for the gaps at a lap (all lap charts of this link group follow). Drag to zoom laps, ' +
      'double-click to reset. Selected drivers are drawn thicker with their code at the end.',
  },
  defaults: { reference: 'leader', drivers: 'all' },
  settings: [
    {
      key: 'reference',
      label: 'Gap to',
      kind: 'choice',
      options: [
        { value: 'leader', label: 'The leader on that lap' },
        { value: 'driver', label: 'The first selected driver' },
      ],
    },
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
  component: lazy(() => import('./GapsWidget').then((m) => ({ default: m.GapsWidget }))),
});
