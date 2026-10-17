import { bestsWidget } from './bests/widget';
import { cornersWidget } from './corners/widget';
import { deltaWidget } from './delta/widget';
import { lapsWidget } from './laps/widget';
import { speedTrapsWidget } from './speedtraps/widget';
import { telemetryWidget } from './telemetry/widget';
import { timelineWidget } from './timeline/widget';
import { trackMapWidget } from './trackmap/widget';
import type { AnyWidgetDef } from './types';

/**
 * Every panel type. Adding a widget = a component plus a widget.ts (definition, help, settings) in
 * widgets/<name>/, and an entry here. Components load lazily, so each widget is its own chunk.
 */
export const WIDGETS: AnyWidgetDef[] = [
  lapsWidget,
  telemetryWidget,
  deltaWidget,
  trackMapWidget,
  bestsWidget,
  speedTrapsWidget,
  timelineWidget,
  cornersWidget,
];

export const WIDGETS_BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));
