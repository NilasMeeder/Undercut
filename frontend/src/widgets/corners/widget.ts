import { lazy } from 'react';
import { defineWidget } from '../types';

export type CornersConfig = { order: 'track' | 'impact'; insights: number };

export const cornersWidget = defineWidget<CornersConfig>({
  id: 'corners',
  title: 'Corners',
  description: 'Where the time is: gain and loss per corner, with the reason',
  help: {
    summary:
      'The lap split per corner: braking zone, corner and the straight after it, up to the top ' +
      'speed before the next corner. Chicanes count as one. Each row compares a lap with the ' +
      'reference: time, brake point, minimum speed, back on full throttle and top speed.',
    watch: [
      'The bar shows who is quicker in that corner, in their colour; the rows add up to the gap.',
      'Losing time with a higher minimum speed often means braking too early or a late throttle.',
      'Differences under 10 m or 3 km/h are greyed out: at ~4 Hz sampling they are within noise.',
      'Brake is on/off only, so “brakes later” is about the brake point, not how hard.',
    ],
    controls:
      'Hover a row to put the group cursor on that corner’s apex; click it to zoom the group there.',
  },
  defaults: { order: 'track', insights: 3 },
  settings: [
    {
      key: 'order',
      label: 'Order',
      kind: 'choice',
      options: [
        { value: 'track', label: 'Track order' },
        { value: 'impact', label: 'Biggest difference' },
      ],
    },
    {
      key: 'insights',
      label: 'Summary lines',
      kind: 'choice',
      options: [
        { value: 0, label: 'None' },
        { value: 3, label: '3' },
        { value: 5, label: '5' },
      ],
    },
  ],
  component: lazy(() => import('./CornersWidget').then((m) => ({ default: m.CornersWidget }))),
});
