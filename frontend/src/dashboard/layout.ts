import type { DockviewApi, SerializedDockview } from 'dockview-react';
import type { GroupId } from '@/store/groups';
import { WIDGETS_BY_ID } from '@/widgets/registry';
import type { WidgetConfig } from '@/widgets/types';

/** Stored per panel in the layout JSON. `config` only holds what differs from the widget defaults. */
export type PanelParams = { group: GroupId; config?: WidgetConfig };

let counter = 0;
const newId = (widget: string) => `${widget}-${Date.now().toString(36)}-${counter++}`;

export function addWidget(api: DockviewApi, widget: string, group: GroupId, position?: Position) {
  return api.addPanel<PanelParams>({
    id: newId(widget),
    component: widget,
    title: WIDGETS_BY_ID.get(widget)?.title ?? widget,
    params: { group },
    position,
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
  const feed = addWidget(api, 'racecontrol', 'blue', {
    referencePanel: corners,
    direction: 'below',
  });
  addWidget(api, 'weather', 'blue', { referencePanel: feed, direction: 'within' });
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
