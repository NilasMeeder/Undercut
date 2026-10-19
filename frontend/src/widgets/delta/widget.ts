import { lazy } from 'react';
import { defineWidget } from '../types';

export type DeltaConfig = { step: number; straightMode: boolean; overtake: boolean };

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
      'A length after a lap (+107 m) means its telemetry is not as long as a normal lap: a gap ' +
        'in the data, or the pit lane. The delta along that lap is then off; at the line it is right.',
      'Straight mode zones (2026): a faint band behind the lines where the wings may go flat ' +
        '(A1, A2… as on the FIA’s circuit map; in low grip the later low-grip starts). The ' +
        'start is the FIA’s activation point (±50 m), the end where most laps brake. Whether ' +
        'a car actually used it is not in the data.',
      'Overtake mode (2026, races): purple lines OT D and OT A where the FIA’s map puts the ' +
        'detection and activation line (±50 m). Within 1 s of the car ahead at OT D gives extra ' +
        'battery power from OT A on; who has it is on the Track map and in the tower.',
    ],
    controls:
      'Hover moves the group cursor. Drag to zoom the whole group, double-click to reset. ' +
      'Shift + drag marks a range and Shift + click a point (with a note and tags); markers are ' +
      'grey bands, fainter when they belong to a lap that is not selected. Click a marker to ' +
      'edit or delete it.',
  },
  defaults: { step: 5, straightMode: true, overtake: true },
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
    { key: 'straightMode', label: 'Straight mode zones (2026)', kind: 'toggle' },
    { key: 'overtake', label: 'Overtake lines (2026)', kind: 'toggle' },
  ],
  component: lazy(() => import('./DeltaWidget').then((m) => ({ default: m.DeltaWidget }))),
});
