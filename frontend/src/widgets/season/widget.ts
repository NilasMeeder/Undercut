import { lazy } from 'react';
import { defineWidget } from '../types';

export type SeasonConfig = { kind: 'Q' | 'SQ'; values: 'gap' | 'pct' };

export const seasonWidget = defineWidget<SeasonConfig>({
  id: 'season',
  title: 'Season: teammates',
  description: 'Teammates in qualifying over the season so far: head to head and the gap per round',
  help: {
    summary:
      'Every pair of teammates in qualifying, round by round, up to this round: who was ahead ' +
      'how often, the median gap, and the gap per round. Each round compares the best laps in ' +
      'the last part both drivers set a time in (Q3 if both got there, else Q2, else Q1), so ' +
      'the car, the track and the time of day are the same.',
    watch: [
      'Ahead counts who got further first, then who was quicker in the same part; a driver ' +
        'without a time loses it. The gap is the first driver’s margin: + = he was quicker.',
      'A gap over 3% is left out of the median (a problem or an aborted lap, not pace); the ' +
        'round still counts for who was ahead. Such a round shows a dot.',
      'A driver who changed team mid-season has a row with each teammate.',
      'The first time, the qualifying of every round is downloaded once (a small file each).',
    ],
    controls:
      'Click a round to open that qualifying with both laps in this link group (in Analysis ' +
      'the telemetry then compares them).',
  },
  defaults: { kind: 'Q', values: 'gap' },
  settings: [
    {
      key: 'kind',
      label: 'Session',
      kind: 'choice',
      options: [
        { value: 'Q', label: 'Qualifying' },
        { value: 'SQ', label: 'Sprint qualifying' },
      ],
    },
    {
      key: 'values',
      label: 'Values',
      kind: 'choice',
      options: [
        { value: 'gap', label: 'Gap in seconds' },
        { value: 'pct', label: 'Gap in % of the lap' },
      ],
    },
  ],
  component: lazy(() => import('./SeasonWidget').then((m) => ({ default: m.SeasonWidget }))),
});
