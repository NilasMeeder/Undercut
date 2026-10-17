import { lazy } from 'react';
import { defineWidget } from '../types';

export type MessageKind = 'flags' | 'deleted' | 'stewards' | 'other';

export type RaceControlConfig = {
  kinds: MessageKind[];
  scope: 'all' | 'group';
  order: 'newest' | 'oldest';
};

export const raceControlWidget = defineWidget<RaceControlConfig>({
  id: 'racecontrol',
  title: 'Race control',
  description: 'Flags, deleted laps and stewards’ decisions',
  help: {
    summary:
      'Every message race control sent during the session, with the time of day (your clock) and ' +
      'the car it is about. Flags are shown in their colour.',
    watch: [
      'Yellow flags in a sector explain slow sector times on laps around that moment.',
      'A deleted lap time no longer counts for the classification; it is struck through in Laps.',
      '“Noted” and “under investigation” can turn into penalties later in the feed.',
    ],
    controls:
      'Click a deleted-lap message to compare that lap. “Only this group” keeps track-wide messages ' +
      'and those about drivers selected in this link group.',
  },
  defaults: { kinds: ['flags', 'deleted', 'stewards', 'other'], scope: 'all', order: 'newest' },
  settings: [
    {
      key: 'kinds',
      label: 'Show',
      kind: 'multi',
      options: [
        { value: 'flags', label: 'Flags' },
        { value: 'deleted', label: 'Deleted laps' },
        { value: 'stewards', label: 'Stewards' },
        { value: 'other', label: 'Other' },
      ],
    },
    {
      key: 'scope',
      label: 'Drivers',
      kind: 'choice',
      options: [
        { value: 'all', label: 'All' },
        { value: 'group', label: 'Only this group' },
      ],
    },
    {
      key: 'order',
      label: 'Order',
      kind: 'choice',
      options: [
        { value: 'newest', label: 'Newest first' },
        { value: 'oldest', label: 'Oldest first' },
      ],
    },
  ],
  component: lazy(() =>
    import('./RaceControlWidget').then((m) => ({ default: m.RaceControlWidget }))
  ),
});
