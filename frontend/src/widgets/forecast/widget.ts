import { lazy } from 'react';
import { FUEL_OPTIONS } from '@/lib/strategy';
import { defineWidget } from '../types';

export type ForecastConfig = { fuel: number };

export const forecastWidget = defineWidget<ForecastConfig>({
  id: 'forecast',
  title: 'Forecast',
  description:
    'The predicted result: everyone at his pace now to the flag, with the stop still owed',
  help: {
    summary:
      'At the session clock (updated every lap): every car from its last line to the flag at its ' +
      'pace now, and the order and gaps that gives. ± is the places gained or lost against now; ' +
      'PASSES are the cars ahead now it is predicted to get past, with the lap the gap goes ' +
      'through zero and stays there.',
    watch: [
      'The pace: the driver’s degradation fit on his current set (as Race pace and the pit ' +
        'window), with the fuel still on board. Just out of the pits, without a clean lap yet: ' +
        'as quick as his last set was when new.',
      'STOP: a car that has run one dry compound still owes a stop: the pit loss, then the ' +
        'other compound (hard after soft or medium). Assumed halfway to the flag: a straight-' +
        'line tyre model always puts the quickest stop at one end of the race, which no team ' +
        'does, so the lap is a placeholder, the cost is not.',
      'Not in the model: traffic and being held up (a pass happens when the gap reaches zero), ' +
        'safety cars, a second stop, team orders. Early in a race the fits are short: watch it ' +
        'settle (Monza 2025: from lap 35 the top six were right).',
    ],
    controls: 'The setting is the fuel correction (as in Race pace).',
  },
  defaults: { fuel: 0.03 },
  settings: [{ key: 'fuel', label: 'Fuel correction', kind: 'choice', options: FUEL_OPTIONS }],
  followsClock: true,
  component: lazy(() => import('./ForecastWidget').then((m) => ({ default: m.ForecastWidget }))),
});
