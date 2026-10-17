import { lazy } from 'react';
import { FUEL_OPTIONS } from '@/lib/strategy';
import { defineWidget } from '../types';

export type PitWindowConfig = {
  compound: 'auto' | 'SOFT' | 'MEDIUM' | 'HARD';
  fuel: number;
};

export const pitWindowWidget = defineWidget<PitWindowConfig>({
  id: 'pitwindow',
  title: 'Pit window',
  description: 'Pit now: where you rejoin, and undercut/overcut on the cars ahead and behind',
  help: {
    summary:
      'For the first driver selected in this link group, at the session clock (updated every lap): ' +
      'where he comes out if he stops now and nobody else does, and what stopping before or after ' +
      'the car ahead and the car behind gains, counted until both are on new tyres.',
    watch: [
      'UNDERCUT: you stop next lap, the rival 1, 2 or 3 laps later. Positive = seconds you gain on him. ' +
        'It gets past a car ahead when the gain is bigger than the gap.',
      'OVERCUT: the rival stops first and you stay out 1–3 laps longer.',
      'The model: lap time = the driver’s own degradation fit on his current set, and the field’s ' +
        'fit for the new compound shifted by his pace. Pace differences between the two drivers ' +
        'count too. Pit loss from the archive (smaller under SC or VSC); the same for both cars.',
      'Not in the model: traffic after the stop, tyre warm-up differences, team orders. Look at ' +
        'the rejoin line for traffic: under ~1.5 s to the car ahead costs time.',
      'A compound nobody has run yet is assumed as quick as a new set of the current one (see notes).',
    ],
    controls:
      'Select a driver in this link group (Stints or Timing tower). The settings choose the new ' +
      'compound (auto: hard after soft or medium, medium after hard) and the fuel correction.',
  },
  defaults: { compound: 'auto', fuel: 0.03 },
  settings: [
    {
      key: 'compound',
      label: 'New tyres',
      kind: 'choice',
      options: [
        { value: 'auto', label: 'Auto (another dry compound)' },
        { value: 'SOFT', label: 'Soft' },
        { value: 'MEDIUM', label: 'Medium' },
        { value: 'HARD', label: 'Hard' },
      ],
    },
    { key: 'fuel', label: 'Fuel correction', kind: 'choice', options: FUEL_OPTIONS },
  ],
  followsClock: true,
  component: lazy(() => import('./PitWindowWidget').then((m) => ({ default: m.PitWindowWidget }))),
});
