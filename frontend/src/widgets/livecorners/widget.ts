import { lazy } from 'react';
import type { ProgressReference } from '@/api/queries';
import { defineWidget } from '../types';

export type LiveCornersConfig = { reference: 'auto' | ProgressReference };

export const liveCornersWidget = defineWidget<LiveCornersConfig>({
  id: 'livecorners',
  title: 'Corners live',
  description: 'Corners of the lap a driver is on, filled in as he gets through each one',
  help: {
    summary:
      'Corners (braking zone, corner and the straight after it) for the lap the driver of this ' +
      'group (the first selected lap) is on at the session clock, against a finished lap of his ' +
      'own: the previous one or the best so far (Auto: previous in a race, best in qualifying ' +
      'and practice, as in Live lap). A corner fills in once the car is through it; the line on ' +
      'top explains the last one. After the line the whole lap stays until he is through the ' +
      'first corner of the next one.',
    watch: [
      'Δ: time in the corner against the reference; minus (green bar) = quicker. The lap row is ' +
        'the sum of the corners so far, the live delta at the end of the last one.',
      'Brake, minimum speed, full throttle and top speed as in Corners: under 10 m or 3 km/h ' +
        'greyed out (4 Hz sampling).',
      'Live the lap is not stretched to the reference (its length is not known yet), so the ' +
        'corners drift a few hundredths, like the live delta.',
    ],
    controls:
      'Hover a row to put the group cursor on that corner’s apex; click it to zoom the group there.',
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
  followsClock: true,
  component: lazy(() =>
    import('./LiveCornersWidget').then((m) => ({ default: m.LiveCornersWidget }))
  ),
});
