import { lazy } from 'react';
import { defineWidget } from '../types';
import { LAP_SCOPE_OPTIONS, scopeFollowsClock, type LapScope } from '../useLapsAtClock';

export type BestsConfig = {
  sectors: 'time' | 'gap';
  order: 'best' | 'ideal';
  scope: LapScope;
};

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
      'AT CLOCK in the clock bar (c): only the laps done at the session clock, with purple and ' +
        'green as they were then; with the clock at the end that is the whole session. ' +
        '“Laps shown” in the settings overrides it for this panel.',
    ],
    controls: 'Click a row to compare that driver’s best lap in this link group.',
  },
  defaults: { sectors: 'time', order: 'best', scope: 'app' },
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
    { key: 'scope', label: 'Laps shown', kind: 'choice', options: LAP_SCOPE_OPTIONS },
  ],
  followsClock: (config) => scopeFollowsClock(config.scope),
  component: lazy(() => import('./BestsWidget').then((m) => ({ default: m.BestsWidget }))),
});
