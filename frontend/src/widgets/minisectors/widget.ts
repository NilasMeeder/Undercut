import { lazy } from 'react';
import { defineWidget } from '../types';

export type MiniSectorsConfig = { count: number; values: 'gap' | 'time' };

export const miniSectorsWidget = defineWidget<MiniSectorsConfig>({
  id: 'minisectors',
  title: 'Mini-sectors',
  description: 'The compared laps per mini-sector: who is quickest where, and the ideal lap',
  help: {
    summary:
      'The lap cut into equal mini-sectors (on the first lap’s distance). Per mini-sector the ' +
      'time of each compared lap: the quickest in purple, the others as the gap to it.',
    watch: [
      'Ideal: the quickest of the compared laps in every mini-sector added up. LOST per lap is ' +
        'its lap time minus that: what it left against the best of the laps here. It is ' +
        'optimistic: in braking zones the ~4 Hz data shifts a little time across a boundary ' +
        '(one lap loses 0.3 s in T1 and gains it back in T2), and the ideal keeps both gains.',
      'Runs of purple for one lap show where it is consistently quicker (slow corners, straights).',
      'Mini-sectors shorter than ~50 m mostly show noise: telemetry is only sampled at ~4 Hz.',
      'The corners in a mini-sector are named in WHERE (as on the Track map).',
    ],
    controls:
      'Hover a row to move the group cursor there; click it to zoom the group onto that ' +
      'mini-sector, click again to zoom out.',
  },
  defaults: { count: 25, values: 'gap' },
  settings: [
    {
      key: 'count',
      label: 'Mini-sectors',
      kind: 'choice',
      options: [
        { value: 10, label: '10' },
        { value: 25, label: '25' },
        { value: 50, label: '50' },
      ],
    },
    {
      key: 'values',
      label: 'Values',
      kind: 'choice',
      options: [
        { value: 'gap', label: 'Gap to the quickest' },
        { value: 'time', label: 'Time' },
      ],
    },
  ],
  component: lazy(() =>
    import('./MiniSectorsWidget').then((m) => ({ default: m.MiniSectorsWidget }))
  ),
});
