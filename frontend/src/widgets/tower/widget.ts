import { lazy } from 'react';
import { defineWidget } from '../types';

export type TowerColumn = 'interval' | 'best' | 'last' | 'sectors' | 'segments' | 'tyre' | 'stops';
export type TowerConfig = { columns: TowerColumn[] };

export const towerWidget = defineWidget<TowerConfig>({
  id: 'tower',
  title: 'Timing tower',
  description: 'The order at the session clock: gaps, sectors, tyres, pit stops',
  help: {
    summary:
      'The timing screen as it stood at the session clock (the bar at the bottom). In a race the ' +
      'order and gaps update at every timing line (S1, S2 and the finish line), like the official ' +
      'tower; in qualifying and practice the order is by best lap, per qualifying part.',
    watch: [
      'Sectors in colour belong to the lap in progress; grey ones are still those of the lap before.',
      'Live recordings: the bars under the sectors are F1’s own mini-sectors of the lap in ' +
        'progress, as the official timing shows them (purple overall best, green personal best, ' +
        'yellow neither, red pit lane). They come straight from F1, a few seconds ahead of the ' +
        'sector times; the archive does not have them.',
      'Purple and green are as they were at that moment: a purple sector can be beaten a lap later.',
      'In qualifying the line under a row is the cut: the drivers below it are out if it ends now.',
      'Deleted lap times never count, also not before the stewards deleted them.',
      'A car that lost places in the pit lane has no gap until it passes the next timing line.',
      'Status: PIT in the pit lane (red) or garage (grey), OUT / IN on an out- or in-lap, DNF retired.',
    ],
    controls:
      'Play, pause and scrub with the clock bar (Space, ← →). Click a row to compare that driver’s ' +
      'latest lap (race) or best lap (qualifying) in this link group.',
  },
  defaults: { columns: ['interval', 'best', 'last', 'sectors', 'segments', 'tyre', 'stops'] },
  settings: [
    {
      key: 'columns',
      label: 'Columns',
      kind: 'multi',
      options: [
        { value: 'interval', label: 'Interval to the car ahead' },
        { value: 'best', label: 'Best lap' },
        { value: 'last', label: 'Last lap' },
        { value: 'sectors', label: 'Sectors' },
        { value: 'segments', label: 'Mini-sectors under the sectors (live recordings)' },
        { value: 'tyre', label: 'Tyre' },
        { value: 'stops', label: 'Pit stops (race) / laps' },
      ],
    },
  ],
  followsClock: true,
  component: lazy(() => import('./TowerWidget').then((m) => ({ default: m.TowerWidget }))),
});
