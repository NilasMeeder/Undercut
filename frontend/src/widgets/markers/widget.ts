import { lazy } from 'react';
import { defineWidget } from '../types';

export type MarkersConfig = { kinds: ('distance' | 'time')[] };

export const markersWidget = defineWidget<MarkersConfig>({
  id: 'markers',
  title: 'Markers',
  description: 'Your notes on this session: marked distances and moments, with tags',
  help: {
    summary:
      'Every marker of the session. A distance marker is a point or range on the lap (metres from ' +
      'the line), shown in the charts, on the map and on the track line. A time marker is a moment ' +
      'or period of the session, shown on the clock bar. Markers are saved in a local database.',
    watch: [
      'A distance marker can be about one lap; it is drawn fainter while that lap is not selected.',
      'Click a tag to see only the markers with that tag.',
    ],
    controls:
      'Make one: Shift + drag (range) or Shift + click (point) in a chart, m for the zoomed range ' +
      'or the cursor, Shift+M or the flag in the clock bar for the moment, Shift + drag on the ' +
      'clock bar for a period. Click a marker to go there, the pencil to edit it.',
  },
  defaults: { kinds: ['distance', 'time'] },
  settings: [
    {
      key: 'kinds',
      label: 'Show',
      kind: 'multi',
      options: [
        { value: 'distance', label: 'Distance markers' },
        { value: 'time', label: 'Time markers' },
      ],
    },
  ],
  component: lazy(() => import('./MarkersWidget').then((m) => ({ default: m.MarkersWidget }))),
});
