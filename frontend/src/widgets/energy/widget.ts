import { lazy } from 'react';
import { defineWidget } from '../types';

export type EnergyConfig = {
  view: 'laps' | 'session';
  metric: 'cost' | 'clipped' | 'downshifts' | 'lost';
};

export const energyWidget = defineWidget<EnergyConfig>({
  id: 'energy',
  title: 'Energy',
  description: 'Estimated battery deployment (2026): where laps clip, and what it costs',
  help: {
    summary:
      'An estimate: there is no battery channel in the data. On every straight the acceleration ' +
      'at full throttle (from the speed trace, corrected for slope) is compared with the best ' +
      'laps of this session on that straight at the same speed. Per lap: where it deploys, where ' +
      'it stops gaining speed at full throttle (clipping: the battery is done, when the best laps ' +
      'still gained there or it goes on to lose speed), and where it loses speed at full throttle ' +
      '(superclipping: the MGU-K harvests while the driver is flat; in one gear the rpm falls ' +
      'with it). The cost is the speed and time the lap would have had by accelerating like the ' +
      'best laps from the clip point to the lift or brake, never faster than the top speed anyone ' +
      'reached on that straight (or holding its own, if that was higher).',
    watch: [
      'LAPS: per straight (named by the corners around it) the selected laps: top speed, speed ' +
        'at the end of full throttle, metres of clipping, its cost, km/h lost at full throttle ' +
        '(Lost), and lift-and-coast before the brake. The faint line under each straight is the ' +
        'whole session (median).',
      'A car can clip and deploy again later on the same straight (Baku: flat at 275 km/h, then ' +
        'deploying to the line): every stretch counts. A fast loss at the very end counts as ' +
        'superclipping when the rpm falls with the speed; otherwise it is the lift showing early.',
      'SESSION: per driver the median over their clean laps. Teams with the same engine often ' +
        'clip alike; a driver who clips less on one straight spends the battery there instead.',
      'The best laps include tows and (in a race) overtake mode, so in a race everyone looks ' +
        'to clip more. Fast corners at full throttle (Curva Grande, Raidillon) are not judged: ' +
        'there grip and drag set the speed.',
      'Down: a downshift at full throttle above 200 km/h. The 2026 fuel flow falls below ' +
        '10,500 rpm, so when a car loses speed harvesting at full throttle some teams drop a ' +
        'gear to keep the engine there; others let the rpm fall. It comes after the clip point, ' +
        'near the end of the straight. SESSION can show it per driver (Session cells).',
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
        { value: 'downshifts', label: 'Downshifts (% of laps)' },
        { value: 'lost', label: 'Speed lost at full throttle (km/h)' },
      ],
    },
  ],
  component: lazy(() => import('./EnergyWidget').then((m) => ({ default: m.EnergyWidget }))),
});
