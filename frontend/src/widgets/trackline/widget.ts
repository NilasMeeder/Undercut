import { lazy } from 'react';
import { defineWidget } from '../types';

export type TrackLineConfig = { corners: boolean; markers: boolean; ghosts: boolean };

export const trackLineWidget = defineWidget<TrackLineConfig>({
  id: 'trackline',
  title: 'Track line',
  description: 'The lap as a straight line with every car on it, at the session clock',
  help: {
    summary:
      'The circuit unrolled into a line from the start/finish line (left) to the next crossing ' +
      '(right), with every car at its place in the lap at the session clock. It shows trains, ' +
      'gaps and who is about to catch whom more clearly than the map.',
    watch: [
      'Cars close together on the line are close on track, whatever lap they are on: lapped cars ' +
        'and battles look the same here, the timing tower tells them apart.',
      'Cars in the garage are not shown. In the pit lane they stay on the line at their distance.',
      'The first time you open a replay widget for a session, the telemetry of every lap is ' +
        'downloaded once (about 10 s for a race).',
      'Pit ghosts: for each driver selected in this link group, a square where he would be had he ' +
        'stopped now (PIT: green-flag pit loss; SC, dashed: under a safety car) and the position ' +
        'he would rejoin in. Cars just ahead of the ghost are the traffic he would come out in.',
    ],
    controls:
      'Drivers selected in this link group are drawn in white. Distance markers are grey bands.',
  },
  defaults: { corners: true, markers: true, ghosts: true },
  settings: [
    { key: 'corners', label: 'Corner numbers', kind: 'toggle' },
    { key: 'markers', label: 'Markers', kind: 'toggle' },
    { key: 'ghosts', label: 'Pit stop ghosts', kind: 'toggle' },
  ],
  followsClock: true,
  component: lazy(() => import('./TrackLineWidget').then((m) => ({ default: m.TrackLineWidget }))),
});
