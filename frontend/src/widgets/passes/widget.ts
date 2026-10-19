import { lazy } from 'react';
import { defineWidget } from '../types';

export type PassesConfig = { show: 'both' | 'drivers' | 'list'; drivers: 'all' | 'group' };

export const passesWidget = defineWidget<PassesConfig>({
  id: 'passes',
  title: 'Passes',
  description: 'Race: every pass for position on track, per driver and where (with overtake mode)',
  help: {
    summary:
      'Every time a car got past another one on the same lap, up to the session clock: per ' +
      'driver how many he made and lost, and the list with the lap, the corner and the ' +
      'position it gave him. Worked out from the positions of all cars.',
    watch: [
      'Left out: pit stops (either car), the start and every standing restart, safety car and ' +
        'red flag laps, a car that has stopped, and lapping (that is not for position).',
      'A pass needs a car from at least 25 m behind to 25 m ahead, so two cars nose to tail ' +
        'do not swap on the noise of the positions. A cut chicane can still look like a pass.',
      '2026: OT is a pass with overtake mode (within 1 s at the detection line). GOT is how ' +
        'often a driver got it, OT PASS how often that became a pass. Passing and being ' +
        're-passed a straight later (the yo-yo of 2026) counts as two passes.',
    ],
    controls:
      'Click a pass to put the clock 5 s before it. Follows the session clock: only the passes ' +
      'until then.',
  },
  defaults: { show: 'both', drivers: 'all' },
  settings: [
    {
      key: 'show',
      label: 'Show',
      kind: 'choice',
      options: [
        { value: 'both', label: 'Drivers and the list' },
        { value: 'drivers', label: 'Drivers only' },
        { value: 'list', label: 'The list only' },
      ],
    },
    {
      key: 'drivers',
      label: 'Drivers',
      kind: 'choice',
      options: [
        { value: 'all', label: 'Everyone' },
        { value: 'group', label: 'Selected in this link group' },
      ],
    },
  ],
  followsClock: true,
  component: lazy(() => import('./PassesWidget').then((m) => ({ default: m.PassesWidget }))),
});
