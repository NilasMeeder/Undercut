import { lazy } from 'react';
import { defineWidget } from '../types';

export type ClockConfig = { timeOfDay: boolean };

export const clockWidget = defineWidget<ClockConfig>({
  id: 'clock',
  title: 'Clock',
  description: 'The session clock: time remaining, or the race time and lap',
  help: {
    summary:
      'The session clock at the clock bar’s time, as on the timing screen. Qualifying and ' +
      'practice: the time remaining in the part (Q1, Q2, Q3) or session. Race: the time since ' +
      'the start and the lap.',
    watch: [
      'Recorded live, this is F1’s own clock, stopped during red flags and between parts.',
      'For older sessions it is worked out: Q1 18, Q2 15, Q3 12 minutes (sprint qualifying 12, ' +
        '10, 8) from the first car out, practice 60 minutes from the first lap, stopped during ' +
        'red flags. It can be a few seconds off.',
    ],
  },
  defaults: { timeOfDay: true },
  settings: [{ key: 'timeOfDay', label: 'Time of day', kind: 'toggle' }],
  constraints: { minimumHeight: 56 },
  followsClock: true,
  component: lazy(() => import('./ClockWidget').then((m) => ({ default: m.ClockWidget }))),
});
