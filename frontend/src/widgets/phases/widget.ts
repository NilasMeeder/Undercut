import { lazy } from 'react';
import { defineWidget } from '../types';

export type PhasesConfig = { order: 'track' | 'impact' };

export const phasesWidget = defineWidget<PhasesConfig>({
  id: 'phases',
  title: 'Corner phases',
  description: 'Braking, rolling, part and full throttle through every corner, lap above lap',
  help: {
    summary:
      'Every corner segment (as in Corners) as a strip per compared lap, from just before the ' +
      'first brake point to just after the last return to full throttle, in the lap’s colour: solid = braking, half = ' +
      'rolling without throttle, light = part throttle, a thin line = full throttle; the tick ' +
      'is the slowest point (apex). On the right the first compared lap against the reference ' +
      '(the first lap): where it brakes, how long it brakes, the apex speed and where it is back ' +
      'on full throttle.',
    watch: [
      'Later on the brakes and shorter braking with the same apex speed is a better entry; a long ' +
        'roll or a long part-throttle stretch is time lost on the exit.',
      'Brake is on/off only (no pressure) and the data ~4 Hz: edges are ±10–20 m, so ' +
        'differences under 10 m are greyed out.',
      'The phases are on the reference lap’s distance (the laps are stretched onto it), like ' +
        'Telemetry and Delta.',
    ],
    controls:
      'Hover a row to put the group cursor on that apex; click it to zoom the group there. ' +
      'Order: along the track, or by the time lost in the corner.',
  },
  defaults: { order: 'track' },
  settings: [
    {
      key: 'order',
      label: 'Order',
      kind: 'choice',
      options: [
        { value: 'track', label: 'Along the track' },
        { value: 'impact', label: 'Biggest difference first' },
      ],
    },
  ],
  component: lazy(() => import('./PhasesWidget').then((m) => ({ default: m.PhasesWidget }))),
});
