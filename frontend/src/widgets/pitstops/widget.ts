import { lazy } from 'react';
import { defineWidget } from '../types';

export type PitStopsConfig = { order: 'fastest' | 'time' };

export const pitStopsWidget = defineWidget<PitStopsConfig>({
  id: 'pitstops',
  title: 'Pit stops',
  description: 'How long each car stood in its pit box, fastest first',
  help: {
    summary:
      'Races: every stop with the time the car stood still and its time in the pit lane, as far ' +
      'as the session clock. F1 sends the time stood still live (recordings and sessions ' +
      'downloaded from F1); otherwise it is measured in the telemetry (≈: from where the car ' +
      'stops to where it moves off, a tenth or two out either way).',
    watch: [
      'A slow stop (over 4 s) is yellow: a wheel that did not come off, a car held for traffic, ' +
        'or a time penalty served at the stop (5 s more).',
      'Lane: pit entry to exit, the stop included. The pit loss against staying out is in Stints.',
      'SC / VSC: stopped under a safety car, when a stop costs less.',
    ],
  },
  defaults: { order: 'fastest' },
  settings: [
    {
      key: 'order',
      label: 'Order',
      kind: 'choice',
      options: [
        { value: 'fastest', label: 'Fastest stop first' },
        { value: 'time', label: 'As they happened' },
      ],
    },
  ],
  component: lazy(() => import('./PitStopsWidget').then((m) => ({ default: m.PitStopsWidget }))),
});
