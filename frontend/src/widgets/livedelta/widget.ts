import { lazy } from 'react';
import type { LiveLapConfig } from '../livelap/widget';
import { defineWidget } from '../types';

export type LiveDeltaConfig = { reference: LiveLapConfig['reference'] };

export const liveDeltaWidget = defineWidget<LiveDeltaConfig>({
  id: 'livedelta',
  title: 'Live delta',
  description: 'The live delta as a big number, with the gap to the car ahead and behind',
  help: {
    summary:
      'The delta of the lap the driver of this group (the first selected lap) is on, at the ' +
      'session clock, as one big number: the same as in the Live lap panel. Above it the gap to ' +
      'the car ahead in the timing tower, under it the gap to the car behind. The layout follows ' +
      'the panel: side by side in a wide, low panel, under each other in a tall one, only the ' +
      'delta in a small one.',
    watch: [
      'Green: quicker than the reference lap so far; yellow: slower. Auto compares with the ' +
        'previous lap in a race and the best lap so far in qualifying and practice.',
      'In a race the gaps are the intervals at the last timing line; in qualifying and practice ' +
        'the difference in best lap time, as in the tower.',
      'Grey: there is no car ahead (P1) or behind (last), or no gap to show.',
      'OT (2026 races): the driver has overtake mode, as in the tower’s OT column.',
      'On an out-lap there is no delta.',
    ],
    controls: 'Follows the clock: press play or LIVE. Pick another lap to follow another driver.',
  },
  defaults: { reference: 'auto' },
  settings: [
    {
      key: 'reference',
      label: 'Against',
      kind: 'choice',
      options: [
        { value: 'auto', label: 'Auto: previous in a race, else best' },
        { value: 'previous', label: 'Previous lap' },
        { value: 'best', label: 'Best lap so far' },
      ],
    },
  ],
  constraints: { minimumHeight: 72 },
  followsClock: true,
  component: lazy(() => import('./LiveDeltaWidget').then((m) => ({ default: m.LiveDeltaWidget }))),
});
