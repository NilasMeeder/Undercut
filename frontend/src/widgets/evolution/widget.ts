import { lazy } from 'react';
import { defineWidget } from '../types';
import { LAP_SCOPE_OPTIONS, scopeFollowsClock, type LapScope } from '../useLapsAtClock';

export type EvolutionConfig = { scope: LapScope };

export const evolutionWidget = defineWidget<EvolutionConfig>({
  id: 'evolution',
  title: 'Track evolution',
  description:
    'Qualifying: how much quicker the track got, and what each best lap was worth at the end',
  help: {
    summary:
      'How much quicker the track got over qualifying, with the drivers taken out: every push ' +
      'lap is the driver’s own level, plus the tyre, plus the track at that moment. The line is ' +
      'the track (up = quicker than at the first push lap), the dots the laps after their ' +
      'driver’s level. Below, every driver’s best lap and what it was worth on the track of ' +
      'the end.',
    watch: [
      'Most of the gain comes early, as rubber goes down: a lap in Q1 is often worth half a ' +
        'second or more by Q3. TRACK is what the track gained after a driver’s best lap; ' +
        'WORTH his best lap minus that. ± is how many places that would have moved him.',
      'A driver out in Q1 or Q2 whose WORTH beats the cut later was not slow, he ran out of ' +
        'track; one whose best came at the very end got the most from the track.',
      'Anything that makes everyone quicker over time counts as track: rubber, cooler air, ' +
        'less wind, and drivers taking more risk in Q3. Rain makes it meaningless (only laps ' +
        'on slicks count, so a drying track shows as a big gain).',
      'An estimate: a push lap scatters about ±0.15 s around the fit (shown at the top). Only ' +
        'qualifying: in practice fuel loads and programmes change through the session.',
    ],
    controls:
      'Hover a dot or a row for the lap; click a row to compare that lap in this link group. ' +
      'Follows the session clock (as Laps shown says): only the laps done by then.',
  },
  defaults: { scope: 'app' },
  settings: [{ key: 'scope', label: 'Laps shown', kind: 'choice', options: LAP_SCOPE_OPTIONS }],
  followsClock: (config) => scopeFollowsClock(config.scope),
  component: lazy(() => import('./EvolutionWidget').then((m) => ({ default: m.EvolutionWidget }))),
});
