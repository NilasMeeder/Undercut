import type { FunctionComponent } from 'react';
import { DeltaWidget } from './delta/DeltaWidget';
import { LapsWidget } from './laps/LapsWidget';
import { TelemetryWidget } from './telemetry/TelemetryWidget';
import { TrackMapWidget } from './trackmap/TrackMapWidget';
import type { WidgetProps } from './types';

export type WidgetDef = {
  id: string;
  title: string;
  description: string;
  component: FunctionComponent<WidgetProps>;
};

/** Every panel type. Adding a widget = a component in widgets/<name>/ + an entry here. */
export const WIDGETS: WidgetDef[] = [
  {
    id: 'laps',
    title: 'Laps',
    description: 'Classification and every lap with sectors; click rows to compare',
    component: LapsWidget,
  },
  {
    id: 'telemetry',
    title: 'Telemetry',
    description: 'Speed, throttle, brake, gear, RPM and DRS over distance',
    component: TelemetryWidget,
  },
  {
    id: 'delta',
    title: 'Delta',
    description: 'Time gained or lost against the reference lap along the lap',
    component: DeltaWidget,
  },
  {
    id: 'trackmap',
    title: 'Track map',
    description: 'Circuit with corners, cursor position and mini-sector winners',
    component: TrackMapWidget,
  },
];

export const WIDGETS_BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));
