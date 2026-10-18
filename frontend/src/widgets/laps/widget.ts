import { lazy } from 'react';
import { defineWidget } from '../types';
import { LAP_SCOPE_OPTIONS, scopeFollowsClock, type LapScope } from '../useLapsAtClock';

export type LapsConfig = { scope: LapScope };

export const lapsWidget = defineWidget<LapsConfig>({
  id: 'laps',
  title: 'Laps',
  description: 'Classification and every lap with sectors; click rows to compare',
  help: {
    summary:
      'Classification: each driver’s best lap. Laps: every lap of the session, filterable by driver. ' +
      'Click a row to add that lap to this panel’s link group; the first lap in a group is the reference.',
    watch: [
      'Purple is the session best, green a personal best. White times are neither.',
      'Deleted laps are struck through and do not count for bests. IN, OUT and SC laps are marked on the right.',
      'Trap is the speed-trap reading. A high trap speed on a slower lap can point at a low-downforce setup.',
      'AT CLOCK in the clock bar (c): only the laps done at the session clock, with purple and ' +
        'green as they were then; with the clock at the end that is the whole session. ' +
        '“Laps shown” in the settings overrides it for this panel.',
    ],
    controls: 'Click a row to select or deselect a lap (up to 8 per group).',
  },
  defaults: { scope: 'app' },
  settings: [{ key: 'scope', label: 'Laps shown', kind: 'choice', options: LAP_SCOPE_OPTIONS }],
  followsClock: (config) => scopeFollowsClock(config.scope),
  component: lazy(() => import('./LapsWidget').then((m) => ({ default: m.LapsWidget }))),
});
