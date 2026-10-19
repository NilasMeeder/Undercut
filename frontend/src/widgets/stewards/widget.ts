import { lazy } from 'react';
import { defineWidget } from '../types';

export type StewardsConfig = { show: 'both' | 'drivers' | 'incidents' };

export const stewardsWidget = defineWidget<StewardsConfig>({
  id: 'stewards',
  title: 'Stewards',
  description: 'Track-limits strikes, investigations and penalties per driver, at the clock',
  help: {
    summary:
      'What race control has said about each driver up to the session clock: laps deleted for ' +
      'track limits, the black-and-white flag, penalties (and whether they were served) and ' +
      'incidents still open. Below, every incident from NOTED to the stewards’ decision.',
    watch: [
      'TL: track-limits strikes. In a race the third brings the black-and-white flag (B/W) and ' +
        'the next one a 5 s penalty. Hover for the laps and corners.',
      'PEN: penalties. +5 s in red is not served yet: it comes off at a pit stop, or is added to ' +
        'his race time at the flag. Served ones are grey. DT drive-through, SG stop-and-go, REP ' +
        'a reprimand.',
      'INV: incidents with him that are noted or under investigation. AFTER THE SESSION means ' +
        'the decision comes after the flag (and is not in the feed).',
      'Read from race control’s text; a message in a form not seen before is left out (the ' +
        'Race control panel still shows it).',
    ],
    controls: 'Click an incident to put the clock where it last changed.',
  },
  defaults: { show: 'both' },
  settings: [
    {
      key: 'show',
      label: 'Show',
      kind: 'choice',
      options: [
        { value: 'both', label: 'Drivers and incidents' },
        { value: 'drivers', label: 'Drivers only' },
        { value: 'incidents', label: 'Incidents only' },
      ],
    },
  ],
  followsClock: true,
  component: lazy(() => import('./StewardsWidget').then((m) => ({ default: m.StewardsWidget }))),
});
