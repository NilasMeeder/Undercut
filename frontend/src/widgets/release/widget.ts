import { lazy } from 'react';
import { defineWidget } from '../types';

export type ReleaseConfig = { horizon: number };

export const releaseWidget = defineWidget<ReleaseConfig>({
  id: 'release',
  title: 'Release',
  description: 'Qualifying: if he leaves the pit now, who is around him on his push lap?',
  help: {
    summary:
      'For the first driver of this link group: if he leaves the pit now, his out-lap (his own ' +
      'typical one, pit exit to the line) puts his push lap at the line at the time shown. The ' +
      'bar is the next two minutes and a half: green when leaving then gives a clear lap, amber ' +
      'when someone is in the way.',
    watch: [
      'In the way: a car on a cool-down lap ahead that he would catch during his lap (with ' +
        'where on the lap), a car starting its push lap less than 2 s behind him (on his tail), ' +
        'or less than 0.8 s ahead (dirty air; more is a tow, which helps).',
      'It is a forecast, also in replay: every car on track goes on at the pace of the lap it ' +
        'is on now (push = his best, cool-down and out-lap = the typical ones this session). ' +
        'Cars still in the garage are not in it: who else leaves is the other teams’ call.',
      'It does not know about the end of the session: check the clock.',
    ],
    controls: 'Select the driver in this link group (click him in the tower). Follows the clock.',
  },
  defaults: { horizon: 150 },
  settings: [
    {
      key: 'horizon',
      label: 'Look ahead',
      kind: 'choice',
      options: [
        { value: 90, label: '1:30' },
        { value: 150, label: '2:30' },
        { value: 240, label: '4:00' },
      ],
    },
  ],
  followsClock: true,
  component: lazy(() => import('./ReleaseWidget').then((m) => ({ default: m.ReleaseWidget }))),
});
