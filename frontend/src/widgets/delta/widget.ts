import { lazy } from 'react';
import { defineWidget } from '../types';

export type DeltaConfig = { step: number };

export const deltaWidget = defineWidget<DeltaConfig>({
  id: 'delta',
  title: 'Delta',
  description: 'Time gained or lost against the reference lap along the lap',
  help: {
    summary:
      'Time behind the reference lap (the first one selected) at every point of the lap. ' +
      'The value at the finish line is exactly the lap time difference.',
    watch: [
      'A rising line means that lap is losing time there; a falling line means it is gaining.',
      'Steep slopes are where the lap is won or lost: usually braking zones and slow corners.',
      'A long, even slope on a straight points at top speed or a poor exit from the corner before.',
    ],
    controls:
      'Hover moves the group cursor. Drag to zoom the whole group, double-click to reset. ' +
      'Shift + drag marks a range and Shift + click a point (with a note and tags); markers are ' +
      'grey bands, fainter when they belong to a lap that is not selected. Click a marker to ' +
      'edit or delete it.',
  },
  defaults: { step: 5 },
  settings: [
    {
      key: 'step',
      label: 'Resolution',
      kind: 'choice',
      options: [
        { value: 2, label: '2 m' },
        { value: 5, label: '5 m' },
        { value: 10, label: '10 m' },
      ],
    },
  ],
  component: lazy(() => import('./DeltaWidget').then((m) => ({ default: m.DeltaWidget }))),
});
