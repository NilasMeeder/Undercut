import { lazy } from 'react';
import { defineWidget } from '../types';

export type TyresConfig = { order: 'session' | 'driver' };

export const tyresWidget = defineWidget<TyresConfig>({
  id: 'tyres',
  title: 'Tyre sets',
  description: 'Every driver’s tyre sets over the weekend: new or used, and how old',
  help: {
    summary:
      'Per driver every set of tyres used this weekend up to this session, in the order they ' +
      'were first used, with the age (laps) at their last lap. Sets used in this session are ' +
      'bright, earlier ones faint; hover a set for where it was used.',
    watch: [
      'The data has no set numbers: a stint on a used set is matched to the earlier set of ' +
        'that compound whose age it continues. A set with a dot was already used before the ' +
        'data starts (or could not be matched). Only drivers of this session are listed: the sets ' +
        'an FP1 rookie used come from the allocation of the driver he replaced, not shown here.',
      'The counts on the right are sets per compound. Before qualifying: how many new softs ' +
        'are left decides how many runs a driver can do (the allocation is usually 13 sets).',
      'In a race: who starts on used tyres from qualifying, and who still has a new set of ' +
        'the compound he needs.',
    ],
    controls: 'Click a driver to compare his best lap of this session in this link group.',
  },
  defaults: { order: 'session' },
  settings: [
    {
      key: 'order',
      label: 'Order',
      kind: 'choice',
      options: [
        { value: 'session', label: 'Best lap in this session' },
        { value: 'driver', label: 'Driver' },
      ],
    },
  ],
  component: lazy(() => import('./TyresWidget').then((m) => ({ default: m.TyresWidget }))),
});
