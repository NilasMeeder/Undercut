import { lazy } from 'react';
import { defineWidget } from '../types';

export type EnergyConfig = { view: 'laps' | 'session'; metric: 'cost' | 'clipped' };

export const energyWidget = defineWidget<EnergyConfig>({
  id: 'energy',
  title: 'Energy',
  description: 'Estimated battery deployment (2026): where laps clip, and what it costs',
  help: {
    summary:
      'An estimate: there is no battery channel in the data. On every straight the acceleration ' +
      'at full throttle (from the speed trace, corrected for slope) is compared with the best ' +
      'laps of this session on that straight at the same speed. Where a lap stops gaining speed ' +
      'while those still gained, the battery is no longer deploying: clipping. The cost is the ' +
      'speed and time the lap would have had by accelerating like the best laps from there to ' +
      'the lift or brake, never faster than the top speed anyone reached on that straight.',
    watch: [
      'LAPS: per straight (named by the corners around it) the selected laps: top speed, speed ' +
        'at the end of full throttle, metres of clipping, its cost, and lift-and-coast before ' +
        'the brake. The faint line under each straight is the whole session (median).',
      'SESSION: per driver the median over their clean laps. Teams with the same engine often ' +
        'clip alike; a driver who clips less on one straight spends the battery there instead.',
      'The best laps include tows and (in a race) overtake mode, so in a race everyone looks ' +
        'to clip more. Fast corners at full throttle (Curva Grande, Raidillon) are not judged: ' +
        'there grip and drag set the speed.',
      'Precision is about half a second of the speed trace (~40 m at 300 km/h). Built from the ' +
        'session’s clean laps; the first time it reads all their telemetry (a few seconds).',
    ],
    controls:
      'Hover a lap row to put the group cursor where it starts clipping; click a straight to ' +
      'zoom the group there. In SESSION, click a driver to select their best lap.',
  },
  defaults: { view: 'laps', metric: 'cost' },
  settings: [
    {
      key: 'view',
      label: 'View',
      kind: 'choice',
      options: [
        { value: 'laps', label: 'Selected laps' },
        { value: 'session', label: 'Session per driver' },
      ],
    },
    {
      key: 'metric',
      label: 'Session cells',
      kind: 'choice',
      options: [
        { value: 'cost', label: 'Time cost (s)' },
        { value: 'clipped', label: 'Metres clipping' },
      ],
    },
  ],
  component: lazy(() => import('./EnergyWidget').then((m) => ({ default: m.EnergyWidget }))),
});
