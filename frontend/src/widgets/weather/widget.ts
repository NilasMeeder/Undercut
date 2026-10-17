import { lazy } from 'react';
import { defineWidget } from '../types';

export const weatherWidget = defineWidget<Record<string, never>>({
  id: 'weather',
  title: 'Weather',
  description: 'Air and track temperature, humidity, wind and rain over the session',
  help: {
    summary:
      'Weather station readings over the session (about one per minute): start, end, range and the ' +
      'trend. The last column is the value when the reference lap of this link group started.',
    watch: [
      'Track temperature drives grip: laps a few degrees apart are not quite like for like.',
      'The ticks on the trend lines mark when the selected laps were driven.',
      'Wind on the main straight changes top speeds; a headwind costs a few km/h at the trap.',
    ],
  },
  defaults: {},
  settings: [],
  component: lazy(() => import('./WeatherWidget').then((m) => ({ default: m.WeatherWidget }))),
});
