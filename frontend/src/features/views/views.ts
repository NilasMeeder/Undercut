import type { View, ViewState } from '@/api/client';
import { useDashboardApi } from '@/dashboard/api';
import { PRESETS, validLayout, type PresetId } from '@/dashboard/layout';
import { clock } from '@/store/clock';
import { cursorBus } from '@/store/cursor';
import { useDashboards } from '@/store/dashboards';
import { GROUP_IDS, useGroups, type GroupId, type LapRef } from '@/store/groups';
import { useSelection, type SessionKey } from '@/store/selection';

/** What a view opens: a saved one (with its id), or a shared link (without). */
export type ViewLike = Pick<View, 'name' | 'year' | 'round' | 'session' | 'state'> & {
  id?: number;
};

/**
 * A saved view is a bookmark: session, laps per link group, zoom, session clock and the layout of
 * the dashboard it was saved from. Opening one puts all of that back, the layout in its own tab.
 */
export function currentView(name: string, session: SessionKey): ViewLike {
  const { tabs, active } = useDashboards.getState();
  const tab = tabs.find((t) => t.id === active);
  const zoom: ViewState['zoom'] = {};
  for (const group of GROUP_IDS) {
    const range = cursorBus.getZoom(group);
    if (range) zoom[group] = range;
  }
  const layout = useDashboardApi.getState().api?.toJSON() ?? tab?.layout ?? null;
  return {
    name,
    ...session,
    state: {
      laps: useGroups.getState().laps,
      zoom,
      clock: clock.time(),
      layout: layout as unknown as ViewState['layout'],
      preset: tab?.preset ?? null,
    },
  };
}

/** A name from what is on screen: "VER L17 vs NOR L20", or the dashboard's name. */
export function suggestName(group: GroupId): string {
  const laps = useGroups.getState().laps[group];
  if (laps.length > 0) return laps.map((l) => `${l.driver} L${l.lap}`).join(' vs ');
  const { tabs, active } = useDashboards.getState();
  return tabs.find((t) => t.id === active)?.name ?? 'View';
}

export function sessionLabel(view: Pick<View, 'year' | 'round' | 'session'>): string {
  return `${view.year} R${view.round} ${view.session}`;
}

export function openView(view: ViewLike) {
  const selection = useSelection.getState();
  const sameSession =
    selection.year === view.year &&
    selection.round === view.round &&
    selection.session === view.session;
  // Another session clears the lap selections (groups.ts); the view's laps are set after that.
  if (!sameSession)
    useSelection.setState({ year: view.year, round: view.round, session: view.session });

  const laps = Object.fromEntries(
    GROUP_IDS.map((g): [GroupId, LapRef[]] => [g, (view.state.laps[g] ?? []).slice()])
  ) as Record<GroupId, LapRef[]>;
  useGroups.setState({ laps });
  for (const group of GROUP_IDS) cursorBus.setZoom(group, view.state.zoom[group] ?? null);

  const t = view.state.clock;
  if (t != null) {
    if (sameSession) {
      clock.pause();
      clock.seek(t);
    } else clock.seekAfterLoad(t);
  }

  const presets = PRESETS.map((p) => p.id as string);
  useDashboards.getState().showView({
    id: view.id,
    name: view.name,
    layout: validLayout(view.state.layout),
    preset: (presets.includes(view.state.preset ?? '')
      ? view.state.preset
      : 'quali-duel') as PresetId,
  });
}

/** A link that opens a view when pasted in the browser: http://…/#view=12. */
export function viewLink(view: View): string {
  return `${location.origin}${location.pathname}#view=${view.id}`;
}

export function viewIdFromHash(): number | null {
  const match = /^#view=(\d+)$/.exec(location.hash);
  return match ? Number(match[1]) : null;
}
