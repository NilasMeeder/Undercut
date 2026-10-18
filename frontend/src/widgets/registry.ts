import { bestsWidget } from './bests/widget';
import { clockWidget } from './clock/widget';
import { cornersWidget } from './corners/widget';
import { deltaWidget } from './delta/widget';
import { energyWidget } from './energy/widget';
import { gapsWidget } from './gaps/widget';
import { lapsWidget } from './laps/widget';
import { liveLapWidget } from './livelap/widget';
import { markersWidget } from './markers/widget';
import { miniSectorsWidget } from './minisectors/widget';
import { paceWidget } from './pace/widget';
import { pitWindowWidget } from './pitwindow/widget';
import { positionsWidget } from './positions/widget';
import { raceControlWidget } from './racecontrol/widget';
import { reportWidget } from './report/widget';
import { speedTrapsWidget } from './speedtraps/widget';
import { stintsWidget } from './stints/widget';
import { telemetryWidget } from './telemetry/widget';
import { timelineWidget } from './timeline/widget';
import { towerWidget } from './tower/widget';
import { trackLineWidget } from './trackline/widget';
import { trackMapWidget } from './trackmap/widget';
import { tyresWidget } from './tyres/widget';
import { weatherWidget } from './weather/widget';
import type { AnyWidgetDef } from './types';

/**
 * Every panel type. Adding a widget = a component plus a widget.ts (definition, help, settings) in
 * widgets/<name>/, and an entry here. Components load lazily, so each widget is its own chunk.
 */
export const WIDGETS: AnyWidgetDef[] = [
  lapsWidget,
  telemetryWidget,
  deltaWidget,
  liveLapWidget,
  trackMapWidget,
  bestsWidget,
  speedTrapsWidget,
  timelineWidget,
  cornersWidget,
  miniSectorsWidget,
  energyWidget,
  reportWidget,
  clockWidget,
  raceControlWidget,
  weatherWidget,
  towerWidget,
  trackLineWidget,
  markersWidget,
  stintsWidget,
  tyresWidget,
  gapsWidget,
  positionsWidget,
  paceWidget,
  pitWindowWidget,
];

export const WIDGETS_BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));
