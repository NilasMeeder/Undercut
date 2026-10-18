import { lazy } from 'react';
import { defineWidget } from '../types';

export type TeammatesConfig = { corners: number };

export const teammatesWidget = defineWidget<TeammatesConfig>({
  id: 'teammates',
  title: 'Teammates',
  description: 'Each team’s drivers side by side: gap, sectors, top speed, where, race pace',
  help: {
    summary:
      'One row per team, the driver with the quicker best lap first. The numbers are what the ' +
      'second driver is behind (+) or ahead (−) on his best lap.',
    watch: [
      'Same car, so the gap is the drivers (and their setups, and whether they got a lap ' +
        'together). A big gap in one sector points at a type of corner.',
      'Top: the second driver’s top speed minus the first’s on the best laps (km/h); a big ' +
        'difference is often a tow or another rear wing. Green is wherever the second is better.',
      'Where: the corners where the gap is biggest (on the quickest lap’s distance; time lost ' +
        'on a straight counts for the corner before it).',
      'Race pace (races): the median of each driver’s clean laps (no pit, SC or lap 1), with ' +
        'how many there were. Different strategies make it less fair: fuel and tyres differ.',
    ],
    controls: 'Click a team to compare both best laps in this link group.',
  },
  defaults: { corners: 2 },
  settings: [
    {
      key: 'corners',
      label: 'Corners shown',
      kind: 'choice',
      options: [
        { value: 1, label: '1' },
        { value: 2, label: '2' },
        { value: 3, label: '3' },
      ],
    },
  ],
  component: lazy(() => import('./TeammatesWidget').then((m) => ({ default: m.TeammatesWidget }))),
});
