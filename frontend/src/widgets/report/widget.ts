import { lazy } from 'react';
import { defineWidget } from '../types';

export type ReportConfig = Record<string, never>;

export const reportWidget = defineWidget<ReportConfig>({
  id: 'report',
  title: 'Report',
  description: 'Session report: where the time is, long runs, degradation, clipping, moments',
  help: {
    summary:
      'What is worth a look in this session, found from the data. Every line opens the comparison ' +
      'that shows it in this link group: the laps, zoomed to the corner or straight, or the clock ' +
      'at the moment.',
    watch: [
      'Where the time is: the best lap of the ten quickest drivers against the fastest lap, and ' +
        'the corner where each loses most (laps with broken telemetry are left out).',
      'Long runs (practice): five or more laps at pace on one set, per compound, by the median ' +
        'lap; the trend is per lap, fuel burn and tyres together (the fuel load is unknown).',
      'Degradation: the field per compound and the stints that stand out, fuel-corrected (see ' +
        'Race pace).',
      'Clipping (2026): who loses most to the battery running out on the straights, against the ' +
        'driver who loses least (see Energy).',
      'Race moments: places gained or lost at the start, the quickest and slowest stop, undercuts ' +
        'that worked and neutralisations.',
    ],
    controls:
      'Click a line: its laps go into this link group (with the zoom), or the clock moves there.',
  },
  defaults: {},
  settings: [],
  component: lazy(() => import('./ReportWidget').then((m) => ({ default: m.ReportWidget }))),
});
