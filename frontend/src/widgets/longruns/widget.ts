import { lazy } from 'react';
import { FUEL_OPTIONS } from '@/lib/strategy';
import { defineWidget } from '../types';

export type LongRunsConfig = { sessions: 'weekend' | 'session'; fuel: number; chart: boolean };

export const longRunsWidget = defineWidget<LongRunsConfig>({
  id: 'longruns',
  title: 'Long runs',
  description: 'Practice race simulations per compound: median lap, gap, degradation, lap by lap',
  help: {
    summary:
      'Every long run in practice: a stint with at least 5 laps at pace on one set (clean, ' +
      'within 107% of the driver’s best lap), per compound with the quickest median first and ' +
      'the gap to it. Below, lap by lap, the runs of the drivers selected in this link group, ' +
      'lined up on the lap of the run.',
    watch: [
      'The fuel load is not in the data. A run with less fuel is quicker, so the medians only ' +
        'compare roughly; the longest runs are usually the race simulations.',
      'DEG is how much slower a lap got per lap on the set, with the fuel burn put back ' +
        '(1.8 kg per lap at the fuel correction of the settings): the tyres alone, if the car ' +
        'burnt that much. The track getting quicker during the session hides in it too, which ' +
        'is why some runs come out below zero. Off = the raw slope.',
      'TYRE: +n is a set that already had n laps on it (practice often re-uses sets); NEW is ' +
        'a new set.',
      'A gap in the little line is a lap not at pace (traffic, a cool lap) in the middle of the ' +
        'run; it stays out of the median.',
      'The runs count up to the session clock, so in a replay or live they grow lap by lap; a ' +
        'run still on its set has a dot after its laps.',
    ],
    controls:
      'Click a run of this session to compare its typical lap (nearest the median) in this link ' +
      'group; a run from an earlier session selects the driver’s best lap here. The chart ' +
      'shows the runs of the drivers in the group.',
  },
  defaults: { sessions: 'weekend', fuel: 0.03, chart: true },
  settings: [
    {
      key: 'sessions',
      label: 'Sessions',
      kind: 'choice',
      options: [
        { value: 'weekend', label: 'This and earlier practice of the weekend' },
        { value: 'session', label: 'This session only' },
      ],
    },
    { key: 'fuel', label: 'Fuel correction', kind: 'choice', options: FUEL_OPTIONS },
    { key: 'chart', label: 'Lap-by-lap chart', kind: 'toggle' },
  ],
  followsClock: true,
  component: lazy(() => import('./LongRunsWidget').then((m) => ({ default: m.LongRunsWidget }))),
});
