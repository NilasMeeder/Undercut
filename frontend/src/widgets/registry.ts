import { battlesWidget } from './battles/widget';
import { bestsWidget } from './bests/widget';
import { clockWidget } from './clock/widget';
import { cornersWidget } from './corners/widget';
import { deltaWidget } from './delta/widget';
import { energyWidget } from './energy/widget';
import { evolutionWidget } from './evolution/widget';
import { gapsWidget } from './gaps/widget';
import { lapsWidget } from './laps/widget';
import { longRunsWidget } from './longruns/widget';
import { liveDeltaWidget } from './livedelta/widget';
import { forecastWidget } from './forecast/widget';
import { phasesWidget } from './phases/widget';
import { safetyCarWidget } from './safetycar/widget';
import { liveCornersWidget } from './livecorners/widget';
import { liveLapWidget } from './livelap/widget';
import { markersWidget } from './markers/widget';
import { miniSectorsWidget } from './minisectors/widget';
import { paceWidget } from './pace/widget';
import { passesWidget } from './passes/widget';
import { pitWindowWidget } from './pitwindow/widget';
import { positionsWidget } from './positions/widget';
import { raceControlWidget } from './racecontrol/widget';
import { radioWidget } from './radio/widget';
import { releaseWidget } from './release/widget';
import { reportWidget } from './report/widget';
import { setupsWidget } from './setups/widget';
import { speedTrapsWidget } from './speedtraps/widget';
import { startsWidget } from './starts/widget';
import { stewardsWidget } from './stewards/widget';
import { stintsWidget } from './stints/widget';
import { teammatesWidget } from './teammates/widget';
import { telemetryWidget } from './telemetry/widget';
import { timelineWidget } from './timeline/widget';
import { towerWidget } from './tower/widget';
import { trackLineWidget } from './trackline/widget';
import { trackMapWidget } from './trackmap/widget';
import { tyresWidget } from './tyres/widget';
import { weatherWidget } from './weather/widget';
import { weekendWidget } from './weekend/widget';
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
  liveDeltaWidget,
  releaseWidget,
  trackMapWidget,
  bestsWidget,
  speedTrapsWidget,
  setupsWidget,
  teammatesWidget,
  timelineWidget,
  evolutionWidget,
  cornersWidget,
  liveCornersWidget,
  phasesWidget,
  miniSectorsWidget,
  energyWidget,
  reportWidget,
  weekendWidget,
  longRunsWidget,
  clockWidget,
  raceControlWidget,
  radioWidget,
  stewardsWidget,
  weatherWidget,
  towerWidget,
  trackLineWidget,
  markersWidget,
  stintsWidget,
  tyresWidget,
  gapsWidget,
  battlesWidget,
  passesWidget,
  startsWidget,
  positionsWidget,
  paceWidget,
  pitWindowWidget,
  forecastWidget,
  safetyCarWidget,
];

export const WIDGETS_BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));
