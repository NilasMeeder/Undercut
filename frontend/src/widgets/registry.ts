import { deltaWidget } from './delta/widget';
import { lapsWidget } from './laps/widget';
import { telemetryWidget } from './telemetry/widget';
import { trackMapWidget } from './trackmap/widget';
import type { AnyWidgetDef } from './types';

/**
 * Every panel type. Adding a widget = a component plus a widget.ts (definition, help, settings) in
 * widgets/<name>/, and an entry here. Components load lazily, so each widget is its own chunk.
 */
export const WIDGETS: AnyWidgetDef[] = [lapsWidget, telemetryWidget, deltaWidget, trackMapWidget];

export const WIDGETS_BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));
