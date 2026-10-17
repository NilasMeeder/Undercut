import { lazy } from 'react';
import { defineWidget } from '../types';

export type ChannelKey = 'speed' | 'throttle' | 'brake' | 'gear' | 'rpm' | 'drs';

export type TelemetryConfig = { channels: ChannelKey[]; step: number };

export const telemetryWidget = defineWidget<TelemetryConfig>({
  id: 'telemetry',
  title: 'Telemetry',
  description: 'Speed, throttle, brake, gear, RPM and DRS over distance',
  help: {
    summary:
      'The selected laps on top of each other, per channel, against distance from the start line. ' +
      'The table above the charts shows every lap at the cursor; Δ is the gap to the reference lap there.',
    watch: [
      'Braking points: the lap whose speed drops later brakes later, and usually gains into the corner.',
      'Minimum speed in a corner and how early throttle goes back to 100%: that decides the exit.',
      'Brake is on/off only (no pressure), and samples are ~4 Hz, so short lifts can be missed.',
    ],
    controls: 'Hover moves the group cursor. Drag to zoom the whole group, double-click to reset.',
  },
  defaults: { channels: ['speed', 'throttle', 'brake', 'gear', 'rpm', 'drs'], step: 5 },
  settings: [
    {
      key: 'channels',
      label: 'Channels',
      kind: 'multi',
      options: [
        { value: 'speed', label: 'Speed' },
        { value: 'throttle', label: 'Throttle' },
        { value: 'brake', label: 'Brake' },
        { value: 'gear', label: 'Gear' },
        { value: 'rpm', label: 'RPM' },
        { value: 'drs', label: 'DRS' },
      ],
    },
    {
      key: 'step',
      label: 'Resolution',
      kind: 'choice',
      options: [
        { value: 2, label: '2 m' },
        { value: 5, label: '5 m' },
        { value: 10, label: '10 m' },
      ],
    },
  ],
  component: lazy(() => import('./TelemetryWidget').then((m) => ({ default: m.TelemetryWidget }))),
});
