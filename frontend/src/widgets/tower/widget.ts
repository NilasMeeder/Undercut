import { lazy } from 'react';
import { defineWidget } from '../types';

export type TowerColumn =
  'interval' | 'cut' | 'predicted' | 'best' | 'last' | 'sectors' | 'segments' | 'tyre' | 'stops';
export type TowerConfig = { columns: TowerColumn[]; size: 'compact' | 'fit' };

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
      'In qualifying the line under a row is the cut: the drivers below it are out if it ends now. ' +
        'Cut: inside it the margin to the first driver out (−0.231 = that much to spare), below ' +
        'it what the driver still needs to find to get in (+0.120).',
      'Pred: the lap in progress, on course for its best lap so far plus the delta at this ' +
        'point, with the position it would give. Purple would be the quickest, green a ' +
        'personal best. Only push laps: not on an out-lap, not in the first 300 m, not when ' +
        'already 1 s down (a cool-down lap).',
      'Deleted lap times never count, also not before the stewards deleted them.',
      'A car that lost places in the pit lane has no gap until it passes the next timing line.',
      'Status: PIT in the pit lane (red) or garage (grey), OUT / IN on an out- or in-lap, DNF retired.',
    ],
    controls:
      'Play, pause and scrub with the clock bar (Space, ← →). Click a row to compare that driver’s ' +
      'latest lap (race) or best lap (qualifying) in this link group.',
  },
  defaults: {
    columns: [
      'interval',
      'cut',
      'predicted',
      'best',
      'last',
      'sectors',
      'segments',
      'tyre',
      'stops',
    ],
    size: 'compact',
  },
  settings: [
    {
      key: 'columns',
      label: 'Columns',
      kind: 'multi',
      options: [
        { value: 'interval', label: 'Interval to the car ahead' },
        { value: 'cut', label: 'Gap to the cut (qualifying)' },
        { value: 'predicted', label: 'Predicted lap time (qualifying, practice)' },
        { value: 'best', label: 'Best lap' },
        { value: 'last', label: 'Last lap' },
        { value: 'sectors', label: 'Sectors' },
        { value: 'segments', label: 'Mini-sectors under the sectors (live recordings)' },
        { value: 'tyre', label: 'Tyre' },
        { value: 'stops', label: 'Pit stops (race) / laps' },
      ],
    },
    {
      key: 'size',
      label: 'Size',
      kind: 'choice',
      options: [
        { value: 'compact', label: 'Compact' },
        { value: 'fit', label: 'Fill the panel (pitwall)' },
      ],
    },
  ],
  followsClock: true,
  component: lazy(() => import('./TowerWidget').then((m) => ({ default: m.TowerWidget }))),
});
