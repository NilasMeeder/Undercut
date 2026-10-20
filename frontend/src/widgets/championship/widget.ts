import { lazy } from 'react';
import { defineWidget } from '../types';

export type ChampionshipConfig = { table: 'drivers' | 'teams' };

export const championshipWidget = defineWidget<ChampionshipConfig>({
  id: 'championship',
  title: 'Championship',
  description: 'The standings as they would be if the race ended now',
  help: {
    summary:
      'Races and sprints: the standings before this session plus the points of the order at the ' +
      'clock, so it moves with the replay and live. Drivers or constructors.',
    watch: [
      'Before = after the previous round (Jolpica), and for a race also this weekend’s sprint.',
      'Arrow: places gained or lost in the championship against before the session.',
      'It is the order on the track: time penalties are not in it (Monza 2025: ANT 8th on the ' +
        'road, 9th after his 5 s). Out of the race = no points, also when a late retirement ' +
        'would still be classified.',
      'Fastest lap point (2019–2024): to the fastest lap so far, if that driver is in the top 10.',
    ],
  },
  defaults: { table: 'drivers' },
  settings: [
    {
      key: 'table',
      label: 'Table',
      kind: 'choice',
      options: [
        { value: 'drivers', label: 'Drivers' },
        { value: 'teams', label: 'Constructors' },
      ],
    },
  ],
  component: lazy(() =>
    import('./ChampionshipWidget').then((m) => ({ default: m.ChampionshipWidget }))
  ),
});
