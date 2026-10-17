import { lazy } from 'react';
import { defineWidget } from '../types';

export type TimelineConfig = { colours: 'live' | 'final' };

export const timelineWidget = defineWidget<TimelineConfig>({
  id: 'timeline',
  title: 'Run timeline',
  description: 'Every lap per driver as a box: improvements, slow laps, pit in/out',
  help: {
    summary:
      'One column per driver, one box per lap, top to bottom; in qualifying grouped by Q1/Q2/Q3. ' +
      'It shows how each driver built up their session: runs, cool-down laps and improvements.',
    watch: [
      'Live colours are as a timing screen showed them at the time: purple = new session best, ' +
        'green = personal best, yellow = slower. Final colours only mark the bests that stood.',
      'IN and OUT are pit laps, grey times are cool-down laps (over 7% off the driver’s best). ' +
        'A struck-through time was deleted, usually for track limits.',
      'Few purple/green boxes late in a session often means the track or tyres stopped improving.',
    ],
    controls: 'Click a box to compare that lap in this link group. Hover for tyre details.',
  },
  defaults: { colours: 'live' },
  settings: [
    {
      key: 'colours',
      label: 'Colours',
      kind: 'choice',
      options: [
        { value: 'live', label: 'As set (live)' },
        { value: 'final', label: 'Final bests' },
      ],
    },
  ],
  component: lazy(() => import('./TimelineWidget').then((m) => ({ default: m.TimelineWidget }))),
});
