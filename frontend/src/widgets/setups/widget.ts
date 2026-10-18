import { lazy } from 'react';
import { defineWidget } from '../types';

export type SetupsConfig = {
  corners: 'all' | 'slow' | 'fast';
  top: 'max' | 'trap';
};

export const setupsWidget = defineWidget<SetupsConfig>({
  id: 'setups',
  title: 'Speed map',
  description: 'Top speed against cornering speed per driver: low drag or high downforce',
  help: {
    summary:
      'Every driver’s best lap as a dot: across, how fast through the corners (the mean ' +
      'minimum speed); up, the top speed. The dashed lines are the field’s medians.',
    watch: [
      'Top left: quick on the straights, slow in the corners: a low-drag setup (small rear wing) ' +
        'or a strong engine. Bottom right: the other way round, high downforce.',
      'Top right is a car that has both: usually the quickest in the session.',
      'Teammates far apart run different wings, or one had a tow on the straight (the top ' +
        'speed in qualifying depends on the car ahead and on DRS until 2025).',
      'Slow corners (minimum below 150 km/h on the quickest lap) are about traction and ' +
        'mechanical grip; the faster ones about downforce. Switch in the settings.',
      'Laps with a gap in their telemetry are left out.',
    ],
    controls: 'Hover a dot for the numbers; click it to compare that lap in this link group.',
  },
  defaults: { corners: 'all', top: 'max' },
  settings: [
    {
      key: 'corners',
      label: 'Cornering speed',
      kind: 'choice',
      options: [
        { value: 'all', label: 'All corners' },
        { value: 'slow', label: 'Slow corners' },
        { value: 'fast', label: 'Medium and fast corners' },
      ],
    },
    {
      key: 'top',
      label: 'Top speed',
      kind: 'choice',
      options: [
        { value: 'max', label: 'Highest on the lap' },
        { value: 'trap', label: 'Speed trap' },
      ],
    },
  ],
  component: lazy(() => import('./SetupsWidget').then((m) => ({ default: m.SetupsWidget }))),
});
