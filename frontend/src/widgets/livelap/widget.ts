import { lazy } from 'react';
import type { ProgressReference } from '@/api/queries';
import { defineWidget } from '../types';

export type LiveLapConfig = { reference: 'auto' | ProgressReference; throttle: boolean };

export const liveLapWidget = defineWidget<LiveLapConfig>({
  id: 'livelap',
  title: 'Live lap',
  description: 'The lap a driver is on at the clock, growing, with the live delta',
  help: {
    summary:
      'The lap the driver of this group (the first selected lap) is on at the session clock, as ' +
      'far as it got, over a finished lap of the same driver: the previous one or the best so ' +
      'far (Auto: the previous lap in a race, the best one in qualifying and practice, where the ' +
      'lap before is mostly an out- or cool-down lap). The number on the right is the live delta ' +
      'at the car’s position, as on TV.',
    watch: [
      'Below zero (green): the lap is quicker than the reference so far; above (yellow): slower.',
      'Live the delta drifts a few hundredths: the distances of two laps differ by a few metres ' +
        'and the lap’s length is not known until it is finished. In a replay it is stretched like ' +
        'the Delta panel, so at the line it is the lap time difference.',
      'Out-laps (after a stop, or out of the garage in qualifying) count from the start of the ' +
        'lap, garage time included: they show no delta.',
      'Live a lap shows a few seconds behind the feed (the clock’s live delay).',
    ],
    controls:
      'Follows the clock: press play or LIVE. Hover moves the group cursor; drag zooms the group.',
  },
  defaults: { reference: 'auto', throttle: true },
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
    { key: 'throttle', label: 'Throttle', kind: 'toggle' },
  ],
  followsClock: true,
  component: lazy(() => import('./LiveLapWidget').then((m) => ({ default: m.LiveLapWidget }))),
});
