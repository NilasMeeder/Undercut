import { lazy } from 'react';
import { defineWidget } from '../types';

export type BattlesConfig = { window: number; show: 'all' | 'close' | 'selected' };

export const battlesWidget = defineWidget<BattlesConfig>({
  id: 'battles',
  title: 'Battles',
  description: 'Race: every car against the one ahead, who is closing and when he can attack',
  help: {
    summary:
      'Per position the car ahead and the car behind at the session clock: the interval at the ' +
      'line, how much the car behind gained per lap over the last laps (+ = closing), and both ' +
      'their mean clean lap times over those laps.',
    watch: [
      'ATTACK: laps until the car behind is within 1 s (DRS until 2025, overtake mode from 2026) ' +
        'at this rate; CATCH: laps until he is on the car ahead. Red when that happens before ' +
        'the end of the race.',
      'No trend over a window with a pit stop, a safety car or lap 1 in it: the gap then says ' +
        'nothing about pace.',
      'A car on a newer tyre usually closes for a few laps and then levels off: the rate is a ' +
        'straight line, the tyres are not.',
    ],
    controls:
      'Click a row to compare both drivers’ last laps in this link group. Follows the session clock.',
  },
  defaults: { window: 3, show: 'all' },
  settings: [
    {
      key: 'window',
      label: 'Trend over',
      kind: 'choice',
      options: [
        { value: 3, label: '3 laps' },
        { value: 5, label: '5 laps' },
      ],
    },
    {
      key: 'show',
      label: 'Show',
      kind: 'choice',
      options: [
        { value: 'all', label: 'Every position' },
        { value: 'close', label: 'Within 3 s or closing' },
        { value: 'selected', label: 'Pairs with a selected driver' },
      ],
    },
  ],
  followsClock: true,
  component: lazy(() => import('./BattlesWidget').then((m) => ({ default: m.BattlesWidget }))),
});
