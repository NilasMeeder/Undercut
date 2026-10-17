import { lazy } from 'react';
import { defineWidget } from '../types';

export type BestsConfig = { sectors: 'time' | 'gap'; order: 'best' | 'ideal' };

export const bestsWidget = defineWidget<BestsConfig>({
  id: 'bests',
  title: 'Bests',
  description: 'Best sectors per driver, gap in %, and the ideal lap',
  help: {
    summary:
      'Each driver’s best lap and best sectors (from any lap that was not deleted). The ideal lap is ' +
      'the sum of a driver’s best three sectors; the top line is the same for the whole session.',
    watch: [
      'Δ ideal is time left on the table: a big number means the best sectors came on different laps.',
      'A driver whose ideal beats someone else’s best lap had the pace but did not put it together.',
      'Purple marks the session best in that column. % is the gap to pole as a share of the lap time.',
    ],
    controls: 'Click a row to compare that driver’s best lap in this link group.',
  },
  defaults: { sectors: 'time', order: 'best' },
  settings: [
    {
      key: 'sectors',
      label: 'Sectors',
      kind: 'choice',
      options: [
        { value: 'time', label: 'Time' },
        { value: 'gap', label: 'Gap to best' },
      ],
    },
    {
      key: 'order',
      label: 'Order by',
      kind: 'choice',
      options: [
        { value: 'best', label: 'Best lap' },
        { value: 'ideal', label: 'Ideal lap' },
      ],
    },
  ],
  component: lazy(() => import('./BestsWidget').then((m) => ({ default: m.BestsWidget }))),
});
