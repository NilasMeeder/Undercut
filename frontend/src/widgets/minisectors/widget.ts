import { lazy } from 'react';
import { defineWidget } from '../types';

export type MiniSectorsConfig = {
  /** Every driver with a block per mini-sector, or the group's compared laps as a table. */
  view: 'field' | 'laps';
  /** Field: the lap on the clock as it is driven, or each driver's best lap. */
  lap: 'current' | 'best';
  count: number;
  values: 'gap' | 'time';
};

export const miniSectorsWidget = defineWidget<MiniSectorsConfig>({
  id: 'minisectors',
  title: 'Mini-sectors',
  description:
    'Every driver with a block per mini-sector, purple, green or yellow, as on the timing screens; or the compared laps per mini-sector',
  help: {
    summary:
      'Field (default): every driver in the order of the tower, with a block per mini-sector ' +
      '(each sector cut into pieces of about 250 m). The lap on the clock fills up as it is ' +
      'driven: purple = the quickest anyone had done there so far, green = the driver’s own ' +
      'quickest so far, yellow = neither; dark = not driven yet on this lap. Laps: the group’s ' +
      'compared laps as a table, the lap cut into equal mini-sectors, the quickest in purple.',
    watch: [
      'Field: the times come from the cars’ positions at 4 Hz (where they cross each ' +
        'boundary), so they are close but not F1’s own timing loops; between two cars a few ' +
        'hundredths can go either way. Colours are as they were when the block was done.',
      'Field: a faint row is a car in the garage, with the last lap it drove. Rows of the ' +
        'drivers in the link groups are lit.',
      'Field, Best lap: each driver’s best lap so far, with the colours it got when it was driven.',
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
  defaults: { view: 'field', lap: 'current', count: 25, values: 'gap' },
  settings: [
    {
      key: 'view',
      label: 'Show',
      kind: 'choice',
      options: [
        { value: 'field', label: 'Field: every driver, a block per mini-sector' },
        { value: 'laps', label: 'Laps: the compared laps as a table' },
      ],
    },
    {
      key: 'lap',
      label: 'Lap (field)',
      kind: 'choice',
      options: [
        { value: 'current', label: 'The lap on the clock' },
        { value: 'best', label: 'Best lap so far' },
      ],
    },
    {
      key: 'count',
      label: 'Mini-sectors (laps)',
      kind: 'choice',
      options: [
        { value: 10, label: '10' },
        { value: 25, label: '25' },
        { value: 50, label: '50' },
      ],
    },
    {
      key: 'values',
      label: 'Values (laps)',
      kind: 'choice',
      options: [
        { value: 'gap', label: 'Gap to the quickest' },
        { value: 'time', label: 'Time' },
      ],
    },
  ],
  followsClock: (config) => config.view === 'field',
  component: lazy(() =>
    import('./MiniSectorsWidget').then((m) => ({ default: m.MiniSectorsWidget }))
  ),
});
