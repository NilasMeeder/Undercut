import { lazy } from 'react';
import { defineWidget } from '../types';

export type SafetyCarConfig = { status: 'auto' | 'sc' | 'vsc' };

export const safetyCarWidget = defineWidget<SafetyCarConfig>({
  id: 'safetycar',
  title: 'Safety car',
  description: 'Under a safety car or VSC: where every car rejoins if it stops now',
  help: {
    summary:
      'At the session clock (updated every lap), for every car: where it comes out if it alone ' +
      'stops now, with the pit loss under a safety car or VSC, against stopping under green. ' +
      'Without a safety car on track it shows what one now would mean.',
    watch: [
      'SC P and ±: the rejoin under the safety car and the places that costs; GREEN P: the same ' +
        'stop under green. The difference is what the safety car is worth to that car.',
      'OWES: one dry compound so far, so the stop has to come anyway: a stop now is the cheap one.',
      'The gaps are those at the last line: under a safety car the field bunches up, so the ' +
        'margins shrink lap by lap (and anyone ahead stopping too changes it).',
      'Pit loss per track status from the archive (the circuit’s typical stops).',
    ],
    controls: 'The setting picks the loss: Auto follows the track status at the clock.',
  },
  defaults: { status: 'auto' },
  settings: [
    {
      key: 'status',
      label: 'Pit loss',
      kind: 'choice',
      options: [
        { value: 'auto', label: 'Auto: the track status at the clock (SC when green)' },
        { value: 'sc', label: 'Safety car' },
        { value: 'vsc', label: 'VSC' },
      ],
    },
  ],
  followsClock: true,
  component: lazy(() => import('./SafetyCarWidget').then((m) => ({ default: m.SafetyCarWidget }))),
});
