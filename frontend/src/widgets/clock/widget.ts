import { lazy } from 'react';
import { defineWidget } from '../types';

export type ClockMode = 'local' | 'session';
export type ClockConfig = { mode: ClockMode };

export const clockWidget = defineWidget<ClockConfig>({
  id: 'clock',
  title: 'Clock',
  description: 'Local time at the circuit, or the session clock: time remaining, race time and lap',
  help: {
    summary:
      'A digital clock at the clock bar’s time. Local: the time of day at the circuit, as on ' +
      'the timing screen there. Session: the time remaining in the part (Q1, Q2, Q3) or ' +
      'practice session, or the time since the race start. The other one stays small beside it.',
    watch: [
      'Recorded live, the session clock is F1’s own, stopped during red flags and between parts.',
      'For older sessions it is worked out: Q1 18, Q2 15, Q3 12 minutes (sprint qualifying 12, ' +
        '10, 8) from the first car out, practice 60 minutes from the first lap, stopped during ' +
        'red flags. It can be a few seconds off.',
      'Local time uses the circuit’s UTC offset from the calendar, for that session.',
    ],
    controls: 'The LOCAL / SESSION button switches the big digits; the panel remembers it.',
  },
  defaults: { mode: 'local' },
  settings: [
    {
      key: 'mode',
      label: 'Big digits',
      kind: 'choice',
      options: [
        { value: 'local', label: 'Local time' },
        { value: 'session', label: 'Session clock' },
      ],
    },
  ],
  constraints: { minimumHeight: 56 },
  followsClock: true,
  component: lazy(() => import('./ClockWidget').then((m) => ({ default: m.ClockWidget }))),
});
