import { lazy } from 'react';
import { defineWidget } from '../types';

export type WeekendConfig = { values: 'gap' | 'time' };

export const weekendWidget = defineWidget<WeekendConfig>({
  id: 'weekend',
  title: 'Weekend',
  description: 'Every driver from the first practice to this session: places, long runs, race pace',
  help: {
    summary:
      'One row per driver, ordered by this session: his place and gap in every session of the ' +
      'weekend so far (practice and qualifying by best lap, the race at the finish), his ' +
      'longest run in practice and, after the race, his race pace.',
    watch: [
      'Practice places say little on their own: fuel loads and programmes differ. A driver who ' +
        'is quick in every session is the real thing.',
      'Long run: the longest stint at pace in practice (the race simulation): median lap, its ' +
        'compound and length, without fuel correction. Compare it with the race pace to see who ' +
        'hid something on Friday.',
      'Race pace: the median of the clean race laps (no pit, SC or lap 1).',
    ],
    controls: 'Click a row to compare his best lap of this session in this link group.',
  },
  defaults: { values: 'gap' },
  settings: [
    {
      key: 'values',
      label: 'Per session',
      kind: 'choice',
      options: [
        { value: 'gap', label: 'Place and gap' },
        { value: 'time', label: 'Place and best lap' },
      ],
    },
  ],
  component: lazy(() => import('./WeekendWidget').then((m) => ({ default: m.WeekendWidget }))),
});
