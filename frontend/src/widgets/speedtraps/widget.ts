import { lazy } from 'react';
import { defineWidget } from '../types';

export type Trap = 'speed_i1' | 'speed_i2' | 'speed_finish' | 'speed_trap';

export type SpeedTrapsConfig = { source: 'max' | 'best'; sort: Trap };

export const speedTrapsWidget = defineWidget<SpeedTrapsConfig>({
  id: 'speedtraps',
  title: 'Speed traps',
  description: 'Top speeds at I1, I2, the finish line and the speed trap',
  help: {
    summary:
      'Speed in km/h at the four official measuring points: the two intermediates (I1, I2), the ' +
      'finish line (FL) and the speed trap (ST), usually at the end of the longest straight.',
    watch: [
      'A high ST with a slow lap points at low downforce or a tow from a car ahead; check both laps.',
      'Max uses every lap except in- and out-laps, so a tow lap can top the list. "Best lap" is fairer.',
      'Δ is the gap to the fastest driver at the sorted trap.',
    ],
    controls: 'Click a row to compare the lap the speed comes from.',
  },
  defaults: { source: 'max', sort: 'speed_trap' },
  settings: [
    {
      key: 'source',
      label: 'Speeds from',
      kind: 'choice',
      options: [
        { value: 'max', label: 'Fastest of any lap' },
        { value: 'best', label: 'Best lap' },
      ],
    },
    {
      key: 'sort',
      label: 'Sort by',
      kind: 'choice',
      options: [
        { value: 'speed_i1', label: 'I1' },
        { value: 'speed_i2', label: 'I2' },
        { value: 'speed_finish', label: 'FL' },
        { value: 'speed_trap', label: 'ST' },
      ],
    },
  ],
  component: lazy(() =>
    import('./SpeedTrapsWidget').then((m) => ({ default: m.SpeedTrapsWidget }))
  ),
});
