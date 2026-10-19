import { lazy } from 'react';
import type { ProgressReference } from '@/api/queries';
import { defineWidget } from '../types';

export type LiveLapConfig = {
  reference: 'auto' | ProgressReference;
  throttle: boolean;
  drivers: 'group' | 'first';
};

export const liveLapWidget = defineWidget<LiveLapConfig>({
  id: 'livelap',
  title: 'Live lap',
  description: 'The lap a driver is on at the clock, growing, with the live delta',
  help: {
    summary:
      'The lap each driver of this group (the drivers of the selected laps, up to four) is on ' +
      'at the session clock, as far as it got, on one distance axis. Each has his own delta to ' +
      'a finished lap of his own: the previous one or the best so far (Auto: the previous lap ' +
      'in a race, the best one in qualifying and practice, where the lap before is mostly an ' +
      'out- or cool-down lap). The number on the right of each row is that live delta at the ' +
      'car’s position, as on TV. With one driver his reference lap is drawn dashed in the speed ' +
      'chart. Drivers: Only the first shows the first selected lap’s driver.',
    watch: [
      'Below zero (green): the lap is quicker than the reference so far; above (yellow): slower.',
      '→ 1:18.862: what the lap is on course for, the reference lap time plus the delta at the ' +
        'car (from 300 m into the lap). Against the previous lap in a race that is a guess at ' +
        'this lap’s time; against the best lap in qualifying, the time he is heading for.',
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
  defaults: { reference: 'auto', throttle: true, drivers: 'group' },
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
    {
      key: 'drivers',
      label: 'Drivers',
      kind: 'choice',
      options: [
        { value: 'group', label: 'Every driver in the group (up to 4)' },
        { value: 'first', label: 'Only the first' },
      ],
    },
    { key: 'throttle', label: 'Throttle', kind: 'toggle' },
  ],
  followsClock: true,
  component: lazy(() => import('./LiveLapWidget').then((m) => ({ default: m.LiveLapWidget }))),
});
