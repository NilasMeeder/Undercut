import type { DockviewApi, SerializedDockview } from 'dockview-react';
import type { DashboardTab, Workspace } from '@/store/dashboards';
import { useSelection } from '@/store/selection';
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

/** Preset: qualifying after the fact: bests and the run timeline, two laps compared, where the
 * time is per mini-sector and corner, and the energy. */
function qualifying(api: DockviewApi) {
  const bests = addWidget(api, 'bests', 'blue');
  const asTab: Position = { referencePanel: bests, direction: 'within' };
  addWidget(api, 'laps', 'blue', asTab);
  addWidget(api, 'timeline', 'blue', asTab);
  addWidget(api, 'tyres', 'blue', asTab);
  bests.api.setActive();
  const telemetry = addWidget(api, 'telemetry', 'blue', {
    referencePanel: bests,
    direction: 'right',
  });
  const map = addWidget(api, 'trackmap', 'blue', { referencePanel: telemetry, direction: 'right' });
  const mini = addWidget(api, 'minisectors', 'blue', { referencePanel: map, direction: 'below' });
  addWidget(api, 'corners', 'blue', { referencePanel: mini, direction: 'within' });
  addWidget(api, 'energy', 'blue', { referencePanel: mini, direction: 'within' });
  addWidget(api, 'setups', 'blue', { referencePanel: mini, direction: 'within' });
  mini.api.setActive();
  const delta = addWidget(api, 'delta', 'blue', { referencePanel: telemetry, direction: 'above' });
  bests.group.api.setSize({ width: 430 });
  map.group.api.setSize({ width: 470, height: 260 });
  delta.group.api.setSize({ height: 160 });
}

/** Preset: the session report next to a comparison: a click on a line shows it there. */
function debrief(api: DockviewApi) {
  const report = addWidget(api, 'report', 'blue');
  const telemetry = addWidget(api, 'telemetry', 'blue', {
    referencePanel: report,
    direction: 'right',
  });
  const map = addWidget(api, 'trackmap', 'blue', { referencePanel: telemetry, direction: 'right' });
  const corners = addWidget(api, 'corners', 'blue', { referencePanel: map, direction: 'below' });
  addWidget(api, 'pace', 'blue', { referencePanel: corners, direction: 'within' });
  addWidget(api, 'teammates', 'blue', { referencePanel: corners, direction: 'within' });
  corners.api.setActive();
  const delta = addWidget(api, 'delta', 'blue', { referencePanel: telemetry, direction: 'above' });
  report.group.api.setSize({ width: Math.min(Math.round(window.innerWidth * 0.32), 620) });
  map.group.api.setSize({ width: 400, height: 300 });
  delta.group.api.setSize({ height: 160 });
}

/** Preset: the session at a glance, no telemetry. */
function overview(api: DockviewApi) {
  const timeline = addWidget(api, 'timeline', 'blue');
  const bests = addWidget(api, 'bests', 'blue', { referencePanel: timeline, direction: 'below' });
  const traps = addWidget(api, 'speedtraps', 'blue', { referencePanel: bests, direction: 'right' });
  addWidget(api, 'setups', 'blue', { referencePanel: traps, direction: 'within' });
  addWidget(api, 'teammates', 'blue', { referencePanel: traps, direction: 'within' });
  traps.api.setActive();
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

/** Screen widths (px) where the pitwall board gets fewer or more panels. */
const NARROW = 1700;
const WIDE = 2400;

/**
 * Preset: the board for live or watching back. The tower big on the left, the map with every car
 * in the middle, the clock and race control on the right, the track line along the bottom. Gaps
 * in a race, otherwise the live lap. How much fits depends on the screen: a laptop gets tabs, a
 * wide screen everything side by side.
 */
function pitwall(api: DockviewApi) {
  const width = window.innerWidth;
  const race = ['R', 'S'].includes(useSelection.getState().session ?? '');
  const tower = addWidget(api, 'tower', 'blue', undefined, { size: 'fit' });
  const map = addWidget(
    api,
    'trackmap',
    'blue',
    { referencePanel: tower, direction: 'right' },
    { cars: 'all' }
  );
  const feed = addWidget(api, 'racecontrol', 'blue', { referencePanel: map, direction: 'right' });
  const clock = addWidget(api, 'clock', 'blue', { referencePanel: feed, direction: 'above' });
  const line = addWidget(api, 'trackline', 'blue', { direction: 'below' });

  if (width < NARROW) {
    // Laptop: what does not fit is a tab next to the map.
    if (race) addWidget(api, 'gaps', 'blue', { referencePanel: map, direction: 'within' });
    if (race) addWidget(api, 'battles', 'blue', { referencePanel: map, direction: 'within' });
    addWidget(api, 'livelap', 'blue', { referencePanel: map, direction: 'within' });
    addWidget(api, 'weather', 'blue', { referencePanel: feed, direction: 'within' });
    map.api.setActive();
    feed.api.setActive();
    tower.group.api.setSize({ width: Math.round(width * 0.4) });
    feed.group.api.setSize({ width: 300 });
  } else {
    const under = addWidget(api, race ? 'gaps' : 'livelap', 'blue', {
      referencePanel: map,
      direction: 'below',
    });
    if (race) addWidget(api, 'battles', 'blue', { referencePanel: under, direction: 'within' });
    if (width >= WIDE) {
      // Wide: the live lap and the positions get their own space, weather under race control.
      if (race) {
        addWidget(api, 'livelap', 'blue', { referencePanel: under, direction: 'right' });
        addWidget(api, 'positions', 'blue', { referencePanel: under, direction: 'within' });
        under.api.setActive();
      }
      addWidget(api, 'weather', 'blue', { referencePanel: feed, direction: 'below' });
      feed.group.api.setSize({ width: 460 });
    } else {
      if (race) addWidget(api, 'livelap', 'blue', { referencePanel: under, direction: 'within' });
      addWidget(api, 'weather', 'blue', { referencePanel: feed, direction: 'within' });
      under.api.setActive();
      feed.api.setActive();
      feed.group.api.setSize({ width: 360 });
    }
    tower.group.api.setSize({ width: Math.min(Math.round(width * 0.34), 900) });
    // The middle column is the screen minus the bars and the track line.
    map.group.api.setSize({ height: Math.round((window.innerHeight - 210) * 0.55) });
  }
  clock.group.api.setSize({ height: 64 });
  line.group.api.setSize({ height: 120 });
}

/**
 * Preset: the qualifying board. The tower with the cut and the predicted lap times, every car on
 * the map with the live lap of the selected driver under it, the session clock (time left), race
 * control and the run timeline on the right, the track line along the bottom.
 */
function qualiBoard(api: DockviewApi) {
  const width = window.innerWidth;
  const tower = addWidget(api, 'tower', 'blue', undefined, { size: 'fit' });
  const map = addWidget(
    api,
    'trackmap',
    'blue',
    { referencePanel: tower, direction: 'right' },
    { cars: 'all' }
  );
  const feed = addWidget(api, 'racecontrol', 'blue', { referencePanel: map, direction: 'right' });
  const clock = addWidget(
    api,
    'clock',
    'blue',
    { referencePanel: feed, direction: 'above' },
    { mode: 'session' }
  );
  const runs = addWidget(api, 'timeline', 'blue', { referencePanel: feed, direction: 'below' });
  addWidget(api, 'tyres', 'blue', { referencePanel: runs, direction: 'within' });
  runs.api.setActive();
  const line = addWidget(api, 'trackline', 'blue', { direction: 'below' });
  if (width < NARROW) {
    addWidget(api, 'livelap', 'blue', { referencePanel: map, direction: 'within' });
    map.api.setActive();
    tower.group.api.setSize({ width: Math.round(width * 0.42) });
    feed.group.api.setSize({ width: 320 });
  } else {
    addWidget(api, 'livelap', 'blue', { referencePanel: map, direction: 'below' });
    tower.group.api.setSize({ width: Math.min(Math.round(width * 0.36), 950) });
    feed.group.api.setSize({ width: width >= WIDE ? 520 : 380 });
    map.group.api.setSize({ height: Math.round((window.innerHeight - 210) * 0.55) });
  }
  runs.group.api.setSize({ height: Math.round((window.innerHeight - 210) * 0.5) });
  clock.group.api.setSize({ height: 64 });
  line.group.api.setSize({ height: 120 });
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
  addWidget(api, 'tyres', 'blue', { referencePanel: pit, direction: 'within' });
  pit.api.setActive();
  const gaps = addWidget(api, 'gaps', 'blue', { referencePanel: stints, direction: 'below' });
  addWidget(api, 'positions', 'blue', { referencePanel: gaps, direction: 'within' });
  gaps.api.setActive();
  const pace = addWidget(api, 'pace', 'blue', { referencePanel: gaps, direction: 'right' });
  addWidget(api, 'battles', 'blue', { referencePanel: pace, direction: 'within' });
  pace.api.setActive();
  map.group.api.setSize({ width: 470, height: 330 });
  stints.group.api.setSize({ height: 380 });
  pace.group.api.setSize({ width: 500 });
}

export const PRESETS = [
  {
    id: 'quali-duel',
    title: 'Quali duel',
    description: 'Two laps: laps, delta, telemetry, map',
    workspaces: ['analysis'],
    apply: qualiDuel,
  },
  {
    id: 'qualifying',
    title: 'Qualifying',
    description: 'Bests, run timeline, two laps compared, mini-sectors, corners, energy',
    workspaces: ['analysis'],
    apply: qualifying,
  },
  {
    id: 'engineer',
    title: 'Engineer',
    description: 'Dense: every analysis panel around one comparison',
    workspaces: ['analysis'],
    apply: engineer,
  },
  {
    id: 'debrief',
    title: 'Debrief',
    description:
      'The session report next to delta, telemetry, map and corners: click a line to see it',
    workspaces: ['analysis'],
    apply: debrief,
  },
  {
    id: 'overview',
    title: 'Session overview',
    description: 'Run timeline, bests, speed traps, race control, weather',
    workspaces: ['analysis'],
    apply: overview,
  },
  {
    id: 'pitwall',
    title: 'Pitwall',
    description:
      'The board: tower, every car on the map, clock, race control, gaps or live lap, track line; fits the screen',
    workspaces: ['pitwall'],
    apply: pitwall,
  },
  {
    id: 'quali-board',
    title: 'Qualifying board',
    description:
      'Tower with the cut and predicted lap times, every car on the map, live lap, time left, run timeline',
    workspaces: ['pitwall'],
    apply: qualiBoard,
  },
  {
    id: 'replay',
    title: 'Replay',
    description:
      'Timing tower, every car on the map, the live lap and the track line, with the clock',
    workspaces: ['pitwall'],
    apply: replay,
  },
  {
    id: 'strategy',
    title: 'Strategy',
    description: 'Stints, gaps, positions, race pace, pit window and pit ghosts on the map',
    workspaces: ['analysis', 'pitwall'],
    apply: strategy,
  },
] as const;

export type PresetId = (typeof PRESETS)[number]['id'];

/** The presets offered in a workspace, its own first. */
export function presetsFor(workspace: Workspace) {
  const own = PRESETS.filter((p) => (p.workspaces as readonly Workspace[]).includes(workspace));
  const other = PRESETS.filter((p) => !(p.workspaces as readonly Workspace[]).includes(workspace));
  return { own, other };
}

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
const CLOCK_PRESETS: ReadonlySet<PresetId> = new Set([
  'overview',
  'pitwall',
  'quali-board',
  'replay',
  'strategy',
]);

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
