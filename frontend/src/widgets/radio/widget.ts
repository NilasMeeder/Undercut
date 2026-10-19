import { lazy } from 'react';
import { defineWidget } from '../types';

export type RadioConfig = { drivers: 'all' | 'group' };

export const radioWidget = defineWidget<RadioConfig>({
  id: 'radio',
  title: 'Team radio',
  description: 'Team radio up to the session clock, newest first; listen, or let it play by itself',
  help: {
    summary:
      'The team radio F1 published for this session, up to the session clock, the newest at ' +
      'the top. Click a clip to listen (click again to stop). The clips are also ticks along ' +
      'the top of the clock bar, in the team colour for the drivers in the link groups.',
    watch: [
      'AUTO plays clips by themselves as the clock passes them (playing a replay, or live): ' +
        'GROUP for the drivers in the link groups, ALL for every car, one after the other. A ' +
        'seek plays nothing. The browser may only allow sound after a first click on the page.',
      'F1 publishes a selection, not every message, and live a clip comes a little after it ' +
        'was said.',
      'The audio is fetched once and kept (from the archive, or from F1 for a live session).',
    ],
    controls: 'Click a row to play or stop. AUTO OFF / GROUP / ALL applies to the whole app.',
  },
  defaults: { drivers: 'all' },
  settings: [
    {
      key: 'drivers',
      label: 'Drivers',
      kind: 'choice',
      options: [
        { value: 'all', label: 'Every car' },
        { value: 'group', label: 'The drivers in this link group' },
      ],
    },
  ],
  followsClock: true,
  component: lazy(() => import('./RadioWidget').then((m) => ({ default: m.RadioWidget }))),
});
