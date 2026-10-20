import type { DockviewApi, SerializedDockview } from 'dockview-react';
import { useDashboards, type DashboardTab, type Workspace } from '@/store/dashboards';
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

/** Screen widths (px) where a preset gets fewer or more panels (the pitwall board) or more
 * (the analysis presets: a laptop gets tabs, a wide screen more side by side). */
const NARROW = 1700;
const WIDE = 2400;
const isWide = () => window.innerWidth >= WIDE;
/** A share of the screen width, in px. */
const share = (part: number) => Math.round(window.innerWidth * part);

/** Preset: laps on the left, delta over telemetry in the middle, track map on the right. */
function qualiDuel(api: DockviewApi) {
  const laps = addWidget(api, 'laps', 'blue');
  const telemetry = addWidget(api, 'telemetry', 'blue', {
    referencePanel: laps,
    direction: 'right',
  });
  const map = addWidget(api, 'trackmap', 'blue', { referencePanel: telemetry, direction: 'right' });
  const delta = addWidget(api, 'delta', 'blue', { referencePanel: telemetry, direction: 'above' });
  if (isWide()) {
    // Wide: where the time is, under the map.
    const corners = addWidget(api, 'corners', 'blue', { referencePanel: map, direction: 'below' });
    laps.group.api.setSize({ width: share(0.2) });
    map.group.api.setSize({ width: share(0.24), height: Math.round(window.innerHeight * 0.45) });
    corners.group.api.setSize({ width: share(0.24) });
  } else {
    laps.group.api.setSize({ width: 430 });
    map.group.api.setSize({ width: 380 });
  }
  delta.group.api.setSize({ height: 170 });
}

/** Preset: everything for one comparison on one screen; tables as tabs on the left. A wide
 * screen gets the bests under the laps and a fourth column with energy and race control. */
function engineer(api: DockviewApi) {
  const wide = isWide();
  const laps = addWidget(api, 'laps', 'blue');
  const telemetry = addWidget(api, 'telemetry', 'blue', {
    referencePanel: laps,
    direction: 'right',
  });
  // The tables after the first split, so a wide screen's bests stay in the left column.
  const bests = addWidget(api, 'bests', 'blue', {
    referencePanel: laps,
    direction: wide ? 'below' : 'within',
  });
  addWidget(api, 'speedtraps', 'blue', { referencePanel: bests, direction: 'within' });
  addWidget(api, 'timeline', 'blue', { referencePanel: bests, direction: 'within' });
  laps.api.setActive();
  if (wide) bests.api.setActive();
  // Right column first, so delta only spans the telemetry column.
  const map = addWidget(api, 'trackmap', 'blue', { referencePanel: telemetry, direction: 'right' });
  const corners = addWidget(api, 'corners', 'blue', { referencePanel: map, direction: 'below' });
  if (!wide) addWidget(api, 'energy', 'blue', { referencePanel: corners, direction: 'within' });
  addWidget(api, 'phases', 'blue', { referencePanel: corners, direction: 'within' });
  corners.api.setActive();
  const energy = wide ? addWidget(api, 'energy', 'blue', { direction: 'right' }) : null;
  const feed = addWidget(api, 'racecontrol', 'blue', {
    referencePanel: energy ?? corners,
    direction: 'below',
  });
  addWidget(api, 'weather', 'blue', { referencePanel: feed, direction: 'within' });
  addWidget(api, 'markers', 'blue', { referencePanel: feed, direction: 'within' });
  feed.api.setActive();
  const delta = addWidget(api, 'delta', 'blue', { referencePanel: telemetry, direction: 'above' });
  if (energy) {
    // Every column from the left; the last one gets the rest.
    laps.group.api.setSize({ width: share(0.18), height: Math.round(window.innerHeight * 0.5) });
    telemetry.group.api.setSize({ width: share(0.4) });
    map.group.api.setSize({ width: share(0.22), height: Math.round(window.innerHeight * 0.4) });
    energy.group.api.setSize({ height: Math.round(window.innerHeight * 0.55) });
  } else {
    laps.group.api.setSize({ width: 400 });
    map.group.api.setSize({ width: 470, height: 240 });
    feed.group.api.setSize({ height: 200 });
  }
  delta.group.api.setSize({ height: 160 });
}

/** Preset: qualifying after the fact: bests and the run timeline, two laps compared, where the
 * time is per mini-sector and corner, and the energy. A wide screen gets the run timeline under
 * the bests and a fourth column with the corners over the energy. */
function qualifying(api: DockviewApi) {
  const wide = isWide();
  const bests = addWidget(api, 'bests', 'blue');
  const asTab: Position = { referencePanel: bests, direction: 'within' };
  addWidget(api, 'laps', 'blue', asTab);
  if (!wide) addWidget(api, 'timeline', 'blue', asTab);
  addWidget(api, 'tyres', 'blue', asTab);
  bests.api.setActive();
  const telemetry = addWidget(api, 'telemetry', 'blue', {
    referencePanel: bests,
    direction: 'right',
  });
  // After the columns, so it stays in the left one.
  if (wide) addWidget(api, 'timeline', 'blue', { referencePanel: bests, direction: 'below' });
  const map = addWidget(api, 'trackmap', 'blue', { referencePanel: telemetry, direction: 'right' });
  // After the session: every driver's best lap, block by block.
  const mini = addWidget(
    api,
    'minisectors',
    'blue',
    { referencePanel: map, direction: 'below' },
    { lap: 'best' }
  );
  const corners = wide
    ? addWidget(api, 'corners', 'blue', { direction: 'right' })
    : addWidget(api, 'corners', 'blue', { referencePanel: mini, direction: 'within' });
  addWidget(api, 'phases', 'blue', { referencePanel: corners, direction: 'within' });
  const energy = wide
    ? addWidget(api, 'energy', 'blue', { referencePanel: corners, direction: 'below' })
    : addWidget(api, 'energy', 'blue', { referencePanel: mini, direction: 'within' });
  addWidget(api, 'setups', 'blue', { referencePanel: energy, direction: 'within' });
  addWidget(api, 'evolution', 'blue', {
    referencePanel: wide ? mini : energy,
    direction: 'within',
  });
  mini.api.setActive();
  if (wide) {
    corners.api.setActive();
    energy.api.setActive();
  }
  const delta = addWidget(api, 'delta', 'blue', { referencePanel: telemetry, direction: 'above' });
  if (wide) {
    // Every column from the left; the last one gets the rest.
    bests.group.api.setSize({ width: share(0.19), height: Math.round(window.innerHeight * 0.5) });
    telemetry.group.api.setSize({ width: share(0.37) });
    map.group.api.setSize({ width: share(0.22), height: Math.round(window.innerHeight * 0.4) });
    corners.group.api.setSize({ height: Math.round(window.innerHeight * 0.5) });
  } else {
    bests.group.api.setSize({ width: 430 });
    map.group.api.setSize({ width: 470, height: 260 });
  }
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
  // Wide: race pace over the teammates in a column of their own.
  const pace = isWide()
    ? addWidget(api, 'pace', 'blue', { direction: 'right' })
    : addWidget(api, 'pace', 'blue', { referencePanel: corners, direction: 'within' });
  const mates = addWidget(api, 'teammates', 'blue', {
    referencePanel: isWide() ? pace : corners,
    direction: isWide() ? 'below' : 'within',
  });
  corners.api.setActive();
  const delta = addWidget(api, 'delta', 'blue', { referencePanel: telemetry, direction: 'above' });
  report.group.api.setSize({ width: Math.min(share(0.32), isWide() ? 760 : 620) });
  if (isWide()) {
    // Every column from the left; the last one gets the rest.
    telemetry.group.api.setSize({ width: share(0.3) });
    map.group.api.setSize({ width: share(0.2), height: Math.round(window.innerHeight * 0.45) });
    mates.group.api.setSize({ height: Math.round(window.innerHeight * 0.4) });
  } else {
    map.group.api.setSize({ width: 400, height: 300 });
  }
  delta.group.api.setSize({ height: 160 });
}

/** Preset: the session at a glance, no telemetry. A wide screen gets the weekend next to the
 * run timeline and the speed map and teammates next to the speed traps. */
function overview(api: DockviewApi) {
  const wide = isWide();
  const timeline = addWidget(api, 'timeline', 'blue');
  const bests = addWidget(api, 'bests', 'blue', { referencePanel: timeline, direction: 'below' });
  const traps = addWidget(api, 'speedtraps', 'blue', { referencePanel: bests, direction: 'right' });
  const setups = addWidget(
    api,
    'setups',
    'blue',
    wide
      ? { referencePanel: traps, direction: 'right' }
      : { referencePanel: traps, direction: 'within' }
  );
  addWidget(api, 'teammates', 'blue', {
    referencePanel: wide ? setups : traps,
    direction: 'within',
  });
  const weekend = addWidget(
    api,
    'weekend',
    'blue',
    wide
      ? { referencePanel: timeline, direction: 'right' }
      : { referencePanel: timeline, direction: 'within' }
  );
  addWidget(api, 'longruns', 'blue', { referencePanel: weekend, direction: 'within' });
  addWidget(api, 'season', 'blue', { referencePanel: weekend, direction: 'within' });
  timeline.api.setActive();
  traps.api.setActive();
  if (wide) {
    weekend.api.setActive();
    setups.api.setActive();
  }
  const feed = addWidget(api, 'racecontrol', 'blue', {
    referencePanel: wide ? setups : traps,
    direction: 'right',
  });
  addWidget(api, 'weather', 'blue', { referencePanel: feed, direction: 'within' });
  feed.api.setActive();
  if (wide) {
    timeline.group.api.setSize({ height: Math.round(window.innerHeight * 0.5) });
    timeline.group.api.setSize({ width: share(0.55) });
    bests.group.api.setSize({ width: share(0.3) });
    traps.group.api.setSize({ width: share(0.2) });
    setups.group.api.setSize({ width: share(0.28) });
  } else {
    timeline.group.api.setSize({ height: 460 });
    bests.group.api.setSize({ width: 640 });
    traps.group.api.setSize({ width: 380 });
  }
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
 * Preset: the qualifying board, as Nilas laid it out (2026-10-18). The tower (laps as a tab) over
 * corners (Corners live as a tab) on the left; every car on the map over the live lap in the middle; the session clock
 * (local time as a tab), race control and release on the right; the track line and the weather
 * along the bottom. Sizes are shares of the screen, so it fits a laptop and a wide screen alike.
 */
function qualiBoard(api: DockviewApi) {
  const width = window.innerWidth;
  // The panels' height: the screen minus the top bar and the clock bar.
  const height = window.innerHeight - 60;
  const tower = addWidget(api, 'tower', 'blue', undefined, { size: 'fit' });
  addWidget(api, 'laps', 'blue', { referencePanel: tower, direction: 'within' });
  tower.api.setActive();
  const map = addWidget(
    api,
    'trackmap',
    'blue',
    { referencePanel: tower, direction: 'right' },
    { cars: 'all' }
  );
  const feed = addWidget(api, 'racecontrol', 'blue', { referencePanel: map, direction: 'right' });
  addWidget(api, 'radio', 'blue', { referencePanel: feed, direction: 'within' });
  feed.api.setActive();
  const clock = addWidget(
    api,
    'clock',
    'blue',
    { referencePanel: feed, direction: 'above' },
    { mode: 'session' }
  );
  addWidget(api, 'clock', 'blue', { referencePanel: clock, direction: 'within' });
  clock.api.setActive();
  const release = addWidget(api, 'release', 'blue', { referencePanel: feed, direction: 'below' });
  const corners = addWidget(api, 'corners', 'blue', { referencePanel: tower, direction: 'below' });
  addWidget(api, 'livecorners', 'blue', { referencePanel: corners, direction: 'within' });
  corners.api.setActive();
  const live = addWidget(api, 'livelap', 'blue', { referencePanel: map, direction: 'below' });
  const line = addWidget(api, 'trackline', 'blue', { direction: 'below' });
  const weather = addWidget(api, 'weather', 'blue', { referencePanel: line, direction: 'right' });

  const top = Math.round(height * 0.81);
  line.group.api.setSize({ height: height - top });
  weather.group.api.setSize({ width: Math.round(width * 0.32) });
  tower.group.api.setSize({ width: Math.round(width * 0.4) });
  feed.group.api.setSize({ width: Math.round(width * 0.24) });
  corners.group.api.setSize({ height: Math.round(top * 0.24) });
  live.group.api.setSize({ height: Math.round(top * 0.64) });
  clock.group.api.setSize({ height: Math.max(64, Math.round(top * 0.14)) });
  release.group.api.setSize({ height: Math.round(top * 0.4) });
}

/**
 * Preset: the race board, as Nilas laid it out (2026-10-20). The tower (fit, the safety car
 * calculator as a tab) over Battles (Passes as a tab) on the left; every car on the map (corner
 * phases as a tab) over the live lap (positions as a tab) in the middle; on the right the clock
 * (local time in front, the race clock as a tab), Live delta, race control (stewards as a tab)
 * and the pit window; the track line and the weather along the bottom. Sizes are shares of the
 * screen, like the qualifying board.
 */
function raceBoard(api: DockviewApi) {
  const width = window.innerWidth;
  // The panels' height: the screen minus the top bar and the clock bar.
  const height = window.innerHeight - 60;
  const tower = addWidget(api, 'tower', 'blue', undefined, { size: 'fit' });
  addWidget(api, 'safetycar', 'blue', { referencePanel: tower, direction: 'within' });
  tower.api.setActive();
  const map = addWidget(
    api,
    'trackmap',
    'blue',
    { referencePanel: tower, direction: 'right' },
    { cars: 'all' }
  );
  addWidget(api, 'phases', 'blue', { referencePanel: map, direction: 'within' });
  map.api.setActive();
  const feed = addWidget(api, 'racecontrol', 'blue', { referencePanel: map, direction: 'right' });
  addWidget(api, 'stewards', 'blue', { referencePanel: feed, direction: 'within' });
  feed.api.setActive();
  const clock = addWidget(
    api,
    'clock',
    'blue',
    { referencePanel: feed, direction: 'above' },
    { mode: 'session' }
  );
  addWidget(api, 'clock', 'blue', { referencePanel: clock, direction: 'within' });
  const delta = addWidget(api, 'livedelta', 'blue', { referencePanel: clock, direction: 'below' });
  const pit = addWidget(api, 'pitwindow', 'blue', { referencePanel: feed, direction: 'below' });
  const battles = addWidget(api, 'battles', 'blue', { referencePanel: tower, direction: 'below' });
  addWidget(api, 'passes', 'blue', { referencePanel: battles, direction: 'within' });
  battles.api.setActive();
  const positions = addWidget(api, 'positions', 'blue', {
    referencePanel: map,
    direction: 'below',
  });
  addWidget(api, 'livelap', 'blue', { referencePanel: positions, direction: 'within' });
  const line = addWidget(api, 'trackline', 'blue', { direction: 'below' });
  const weather = addWidget(api, 'weather', 'blue', { referencePanel: line, direction: 'right' });

  const top = Math.round(height * 0.83);
  line.group.api.setSize({ height: height - top });
  weather.group.api.setSize({ width: Math.round(width * 0.24) });
  tower.group.api.setSize({ width: Math.round(width * 0.37) });
  feed.group.api.setSize({ width: Math.round(width * 0.22) });
  battles.group.api.setSize({ height: Math.round(top * 0.28) });
  positions.group.api.setSize({ height: Math.round(top * 0.66) });
  clock.group.api.setSize({ height: Math.max(64, Math.round(top * 0.12)) });
  delta.group.api.setSize({ height: Math.max(72, Math.round(top * 0.17)) });
  pit.group.api.setSize({ height: Math.round(top * 0.34) });
}

/** Preset: the race lap by lap with the clock; stints, gaps, pace and the pit window. */
function strategy(api: DockviewApi) {
  if (useDashboards.getState().workspace === 'pitwall') return strategyBoard(api);
  if (isWide()) return strategyWide(api);
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
  addWidget(api, 'forecast', 'blue', { referencePanel: pit, direction: 'within' });
  addWidget(api, 'championship', 'blue', { referencePanel: pit, direction: 'within' });
  pit.api.setActive();
  const gaps = addWidget(api, 'gaps', 'blue', { referencePanel: stints, direction: 'below' });
  addWidget(api, 'positions', 'blue', { referencePanel: gaps, direction: 'within' });
  gaps.api.setActive();
  const pace = addWidget(api, 'pace', 'blue', { referencePanel: gaps, direction: 'right' });
  addWidget(api, 'battles', 'blue', { referencePanel: pace, direction: 'within' });
  addWidget(api, 'starts', 'blue', { referencePanel: pace, direction: 'within' });
  pace.api.setActive();
  map.group.api.setSize({ width: 470, height: 330 });
  stints.group.api.setSize({ height: 380 });
  pace.group.api.setSize({ width: 500 });
}

/**
 * The strategy preset in Pitwall, as Nilas laid it out (2026-10-20). Stints next to the safety
 * car calculator (the forecast as a tab) over Battles (gaps and positions as tabs) next to the
 * race pace (battles and starts as tabs); on the right Live delta beside the session clock, the
 * map with every car, and the pit window (the tower and the tyre sets as tabs). Sizes are shares
 * of the screen, like the race board.
 */
function strategyBoard(api: DockviewApi) {
  const width = window.innerWidth;
  // The panels' height: the screen minus the top bar and the clock bar.
  const height = window.innerHeight - 60;
  const stints = addWidget(api, 'stints', 'blue');
  // Right column first, so it runs the full height.
  const map = addWidget(
    api,
    'trackmap',
    'blue',
    { referencePanel: stints, direction: 'right' },
    { cars: 'all' }
  );
  const clock = addWidget(
    api,
    'clock',
    'blue',
    { referencePanel: map, direction: 'above' },
    { mode: 'session' }
  );
  const delta = addWidget(api, 'livedelta', 'blue', { referencePanel: clock, direction: 'left' });
  const pit = addWidget(api, 'pitwindow', 'blue', { referencePanel: map, direction: 'below' });
  addWidget(api, 'tower', 'blue', { referencePanel: pit, direction: 'within' });
  addWidget(api, 'tyres', 'blue', { referencePanel: pit, direction: 'within' });
  pit.api.setActive();
  // The rows on the left before their right halves, so each row splits on its own.
  const gaps = addWidget(api, 'gaps', 'blue', { referencePanel: stints, direction: 'below' });
  addWidget(api, 'positions', 'blue', { referencePanel: gaps, direction: 'within' });
  const battles = addWidget(api, 'battles', 'blue', { referencePanel: gaps, direction: 'within' });
  battles.api.setActive();
  const safetyCar = addWidget(api, 'safetycar', 'blue', {
    referencePanel: stints,
    direction: 'right',
  });
  addWidget(api, 'forecast', 'blue', { referencePanel: safetyCar, direction: 'within' });
  safetyCar.api.setActive();
  const pace = addWidget(api, 'pace', 'blue', { referencePanel: gaps, direction: 'right' });
  addWidget(api, 'battles', 'blue', { referencePanel: pace, direction: 'within' });
  addWidget(api, 'starts', 'blue', { referencePanel: pace, direction: 'within' });
  pace.api.setActive();

  map.group.api.setSize({ width: Math.round(width * 0.3), height: Math.round(height * 0.32) });
  clock.group.api.setSize({ height: Math.max(64, Math.round(height * 0.115)) });
  delta.group.api.setSize({ width: Math.round(width * 0.125) });
  stints.group.api.setSize({
    width: Math.round(width * 0.405),
    height: Math.round(height * 0.535),
  });
  gaps.group.api.setSize({ width: Math.round(width * 0.364) });
}

/** The strategy preset on a wide screen: four columns, everything side by side but the tyre
 * sets and the starts: stints over gaps, race pace over positions, the map over the pit window,
 * the tower over the forecast and the battles. */
function strategyWide(api: DockviewApi) {
  const stints = addWidget(api, 'stints', 'blue');
  const map = addWidget(
    api,
    'trackmap',
    'blue',
    { referencePanel: stints, direction: 'right' },
    { cars: 'all' }
  );
  const pace = addWidget(api, 'pace', 'blue', { referencePanel: stints, direction: 'right' });
  const tower = addWidget(api, 'tower', 'blue', { direction: 'right' });
  addWidget(api, 'gaps', 'blue', { referencePanel: stints, direction: 'below' });
  addWidget(api, 'positions', 'blue', { referencePanel: pace, direction: 'below' });
  const pit = addWidget(api, 'pitwindow', 'blue', { referencePanel: map, direction: 'below' });
  addWidget(api, 'tyres', 'blue', { referencePanel: pit, direction: 'within' });
  pit.api.setActive();
  const forecast = addWidget(api, 'forecast', 'blue', {
    referencePanel: tower,
    direction: 'below',
  });
  addWidget(api, 'championship', 'blue', { referencePanel: forecast, direction: 'within' });
  forecast.api.setActive();
  const battles = addWidget(api, 'battles', 'blue', {
    referencePanel: forecast,
    direction: 'below',
  });
  addWidget(api, 'starts', 'blue', { referencePanel: battles, direction: 'within' });
  battles.api.setActive();
  const height = window.innerHeight - 60;
  // Every column from the left; the last one gets the rest.
  stints.group.api.setSize({ width: share(0.3), height: Math.round(height * 0.45) });
  pace.group.api.setSize({ width: share(0.24), height: Math.round(height * 0.5) });
  map.group.api.setSize({ width: share(0.22), height: Math.round(height * 0.4) });
  tower.group.api.setSize({ height: Math.round(height * 0.38) });
  forecast.group.api.setSize({ height: Math.round(height * 0.32) });
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
    description:
      'Bests, run timeline, two laps compared, mini-sectors, corners, energy, track evolution',
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
      'Tower and corners, every car on the map over the live lap, time left, race control, release, track line, weather',
    workspaces: ['pitwall'],
    apply: qualiBoard,
  },
  {
    id: 'race-board',
    title: 'Race board',
    description:
      'Tower with the safety car and battles, every car on the map over the live lap, clock, live delta, race control and stewards, pit window, track line, weather',
    workspaces: ['pitwall'],
    apply: raceBoard,
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
    description:
      'Stints, safety car, battles, gaps, race pace, pit window and pit ghosts on the map; in Pitwall with live delta and the clock',
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
    panels.length > 0 &&
    panels.every((p) => typeof p === 'object' && WIDGETS_BY_ID.has(p?.contentComponent ?? ''));
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
