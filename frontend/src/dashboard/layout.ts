import type { DockviewApi, SerializedDockview } from 'dockview-react';
import type { DashboardTab } from '@/store/dashboards';
import type { GroupId } from '@/store/groups';
import { WIDGETS_BY_ID } from '@/widgets/registry';
import { resolveConfig, type WidgetConfig } from '@/widgets/types';

/** Stored per panel in the layout JSON. `config` only holds what differs from the widget defaults. */
export type PanelParams = { group: GroupId; config?: WidgetConfig };

let counter = 0;
const newId = (widget: string) => `${widget}-${Date.now().toString(36)}-${counter++}`;

export function addWidget(
  api: DockviewApi,
  widget: string,
  group: GroupId,
  position?: Position,
  config?: WidgetConfig
) {
  const def = WIDGETS_BY_ID.get(widget);
  return api.addPanel<PanelParams>({
    id: newId(widget),
    component: widget,
    title: def?.title ?? widget,
    params: config ? { group, config } : { group },
    position,
    ...def?.constraints,
  });
}

type Position = Parameters<DockviewApi['addPanel']>[0]['position'];

/** Preset: laps on the left, delta over telemetry in the middle, track map on the right. */
function qualiDuel(api: DockviewApi) {
  const laps = addWidget(api, 'laps', 'blue');
  const telemetry = addWidget(api, 'telemetry', 'blue', {
    referencePanel: laps,
    direction: 'right',
  });
  const map = addWidget(api, 'trackmap', 'blue', { referencePanel: telemetry, direction: 'right' });
  const delta = addWidget(api, 'delta', 'blue', { referencePanel: telemetry, direction: 'above' });
  laps.group.api.setSize({ width: 430 });
  map.group.api.setSize({ width: 380 });
  delta.group.api.setSize({ height: 170 });
}

/** Preset: everything for one comparison on one screen; tables as tabs on the left. */
function engineer(api: DockviewApi) {
  const laps = addWidget(api, 'laps', 'blue');
  const asTab: Position = { referencePanel: laps, direction: 'within' };
  addWidget(api, 'bests', 'blue', asTab);
  addWidget(api, 'speedtraps', 'blue', asTab);
  addWidget(api, 'timeline', 'blue', asTab);
  laps.api.setActive();
  const telemetry = addWidget(api, 'telemetry', 'blue', {
    referencePanel: laps,
    direction: 'right',
  });
  // Right column first, so delta only spans the telemetry column.
  const map = addWidget(api, 'trackmap', 'blue', { referencePanel: telemetry, direction: 'right' });
  const corners = addWidget(api, 'corners', 'blue', { referencePanel: map, direction: 'below' });
  addWidget(api, 'energy', 'blue', { referencePanel: corners, direction: 'within' });
  corners.api.setActive();
  const feed = addWidget(api, 'racecontrol', 'blue', {
    referencePanel: corners,
    direction: 'below',
  });
  addWidget(api, 'weather', 'blue', { referencePanel: feed, direction: 'within' });
  addWidget(api, 'markers', 'blue', { referencePanel: feed, direction: 'within' });
  feed.api.setActive();
  const delta = addWidget(api, 'delta', 'blue', { referencePanel: telemetry, direction: 'above' });
  laps.group.api.setSize({ width: 400 });
  map.group.api.setSize({ width: 470, height: 240 });
  feed.group.api.setSize({ height: 200 });
  delta.group.api.setSize({ height: 160 });
}

/** Preset: the session at a glance, no telemetry. */
function overview(api: DockviewApi) {
  const timeline = addWidget(api, 'timeline', 'blue');
  const bests = addWidget(api, 'bests', 'blue', { referencePanel: timeline, direction: 'below' });
  const traps = addWidget(api, 'speedtraps', 'blue', { referencePanel: bests, direction: 'right' });
  const feed = addWidget(api, 'racecontrol', 'blue', { referencePanel: traps, direction: 'right' });
  addWidget(api, 'weather', 'blue', { referencePanel: feed, direction: 'within' });
  feed.api.setActive();
  timeline.group.api.setSize({ height: 460 });
  bests.group.api.setSize({ width: 640 });
  traps.group.api.setSize({ width: 380 });
}

/** Preset: watch the session back with the clock bar; tower, map with all cars, track line. */
function replay(api: DockviewApi) {
  const tower = addWidget(api, 'tower', 'blue');
  const map = addWidget(
    api,
    'trackmap',
    'blue',
    { referencePanel: tower, direction: 'right' },
    {
      cars: 'all',
    }
  );
  addWidget(api, 'livelap', 'blue', { referencePanel: map, direction: 'within' });
  map.api.setActive();
  const feed = addWidget(api, 'racecontrol', 'blue', { referencePanel: map, direction: 'right' });
  addWidget(api, 'weather', 'blue', { referencePanel: feed, direction: 'within' });
  addWidget(api, 'markers', 'blue', { referencePanel: feed, direction: 'within' });
  feed.api.setActive();
  const clock = addWidget(api, 'clock', 'blue', { referencePanel: feed, direction: 'above' });
  const line = addWidget(api, 'trackline', 'blue', { referencePanel: map, direction: 'below' });
  tower.group.api.setSize({ width: 560 });
  feed.group.api.setSize({ width: 360 });
  line.group.api.setSize({ height: 120 });
  clock.group.api.setSize({ height: 64 });
}

/** Preset: the race lap by lap with the clock; stints, gaps, pace and the pit window. */
function strategy(api: DockviewApi) {
  const stints = addWidget(api, 'stints', 'blue');
  // Right column first, so it runs the full height: map over the pit window (and the tower).
  const map = addWidget(
    api,
    'trackmap',
    'blue',
    { referencePanel: stints, direction: 'right' },
    { cars: 'all' }
  );
  const pit = addWidget(api, 'pitwindow', 'blue', { referencePanel: map, direction: 'below' });
  addWidget(api, 'tower', 'blue', { referencePanel: pit, direction: 'within' });
  pit.api.setActive();
  const gaps = addWidget(api, 'gaps', 'blue', { referencePanel: stints, direction: 'below' });
  addWidget(api, 'positions', 'blue', { referencePanel: gaps, direction: 'within' });
  gaps.api.setActive();
  const pace = addWidget(api, 'pace', 'blue', { referencePanel: gaps, direction: 'right' });
  map.group.api.setSize({ width: 470, height: 330 });
  stints.group.api.setSize({ height: 380 });
  pace.group.api.setSize({ width: 500 });
}

export const PRESETS = [
  {
    id: 'quali-duel',
    title: 'Quali duel',
    description: 'Two laps: laps, delta, telemetry, map',
    apply: qualiDuel,
  },
  {
    id: 'engineer',
    title: 'Engineer',
    description: 'Dense: every analysis panel around one comparison',
    apply: engineer,
  },
  {
    id: 'overview',
    title: 'Session overview',
    description: 'Run timeline, bests, speed traps, race control, weather',
    apply: overview,
  },
  {
    id: 'replay',
    title: 'Replay',
    description:
      'Timing tower, every car on the map, the live lap and the track line, with the clock',
    apply: replay,
  },
  {
    id: 'strategy',
    title: 'Strategy',
    description: 'Stints, gaps, positions, race pace, pit window and pit ghosts on the map',
    apply: strategy,
  },
] as const;

export type PresetId = (typeof PRESETS)[number]['id'];

export function applyPreset(api: DockviewApi, id: PresetId) {
  api.clear();
  (PRESETS.find((p) => p.id === id) ?? PRESETS[0]).apply(api);
}

/** A stored layout that still matches the registered widgets, or null. */
export function validLayout(layout: unknown): SerializedDockview | null {
  if (!layout || typeof layout !== 'object' || !('grid' in layout)) return null;
  const panels = Object.values((layout as SerializedDockview).panels ?? {});
  const known =
    panels.length > 0 && panels.every((p) => WIDGETS_BY_ID.has(p.contentComponent ?? ''));
  return known ? (layout as SerializedDockview) : null;
}

/** Presets with a panel that moves with the session clock, for a tab that has no layout yet. */
const CLOCK_PRESETS: ReadonlySet<PresetId> = new Set(['overview', 'replay', 'strategy']);

/** Whether any panel of a dashboard tab moves with the session clock. */
export function followsClock(tab: DashboardTab): boolean {
  const layout = validLayout(tab.layout);
  if (!layout) return CLOCK_PRESETS.has(tab.preset);
  return Object.values(layout.panels).some((panel) => {
    const widget = WIDGETS_BY_ID.get(panel.contentComponent ?? '');
    const follows = widget?.followsClock;
    if (!widget || typeof follows !== 'function') return follows === true;
    return follows(resolveConfig(widget, (panel.params as PanelParams | undefined)?.config));
  });
}
