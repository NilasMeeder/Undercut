import { lazy } from 'react';
import { defineWidget } from '../types';

export type ChannelKey = 'speed' | 'throttle' | 'brake' | 'gear' | 'rpm' | 'drs' | 'deploy';

export type TelemetryConfig = { channels: ChannelKey[]; step: number; clipping: boolean };

export const telemetryWidget = defineWidget<TelemetryConfig>({
  id: 'telemetry',
  title: 'Telemetry',
  description: 'Speed, throttle, brake, gear, RPM, DRS and (2026) estimated deploy over distance',
  help: {
    summary:
      'The selected laps on top of each other, per channel, against distance from the start line. ' +
      'The table above the charts shows every lap at the cursor; Δ is the gap to the reference lap there.',
    watch: [
      'Braking points: the lap whose speed drops later brakes later, and usually gains into the corner.',
      'Minimum speed in a corner and how early throttle goes back to 100%: that decides the exit.',
      'Brake is on/off only (no pressure), and samples are ~4 Hz, so short lifts can be missed.',
      'From 2026: amber strips along the bottom of the speed chart, one row per lap (the first ' +
        'lap lowest), mark clipping: full throttle without gaining speed where the best laps on that straight ' +
        'still did (the battery is not deploying). An estimate, see the Energy panel.',
      'Deploy (2026, estimated): acceleration at full throttle as a share of the best laps on ' +
        'that straight at that speed: 100% is as hard as the best, 0 is not gaining. Purple ' +
        'where it gains more than the engine alone could (the battery deploying, as on the ' +
        'Track map); a line without fill gains, but not clearly with the battery. Amber below ' +
        'zero: losing speed at full throttle, the battery harvesting ' +
        '("super clipping"). Empty off the throttle, in fast corners and near top speed.',
      'Triangles at the top of the gear chart: a downshift at full throttle above 200 km/h. ' +
        'In 2026 that keeps the engine above 10,500 rpm, where the fuel flow is at its maximum, ' +
        'while the car loses speed harvesting. Some teams do it, others let the rpm drop.',
    ],
    controls:
      'Hover moves the group cursor. Drag to zoom the whole group, double-click to reset. ' +
      'Shift + drag marks a range and Shift + click a point (with a note and tags); markers are ' +
      'grey bands, fainter when they belong to a lap that is not selected. Click a marker to ' +
      'edit or delete it.',
  },
  defaults: {
    channels: ['speed', 'throttle', 'brake', 'gear', 'rpm', 'drs', 'deploy'],
    step: 5,
    clipping: true,
  },
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
        { value: 'deploy', label: 'Deploy (2026)' },
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
    { key: 'clipping', label: 'Clipping and downshifts (2026)', kind: 'toggle' },
  ],
  component: lazy(() => import('./TelemetryWidget').then((m) => ({ default: m.TelemetryWidget }))),
});
