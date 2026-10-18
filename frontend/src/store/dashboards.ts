import type { SerializedDockview } from 'dockview-react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PresetId } from '@/dashboard/layout';

/**
 * Two workspaces, each with its own tabs: Analysis (after a session: compare laps, the clock at
 * the end) and Pitwall (a board that plays: tower, map, clock; AT CLOCK always on).
 */
export type Workspace = 'analysis' | 'pitwall';

export const WORKSPACES: { id: Workspace; title: string }[] = [
  { id: 'analysis', title: 'Analysis' },
  { id: 'pitwall', title: 'Pitwall' },
];

/** One dashboard tab: its own dockview layout, or a preset until it is first changed. */
export type DashboardTab = {
  id: string;
  name: string;
  layout: SerializedDockview | null;
  preset: PresetId;
  /** Missing in tabs from before the workspaces: then the preset decides. */
  workspace?: Workspace;
  /** The saved view this tab shows: opening that view again reuses the tab. */
  viewId?: number;
};

type DashboardsState = {
  tabs: DashboardTab[];
  /** The active tab of this window's workspace. */
  active: string;
  /** The last active tab per workspace. */
  actives: Partial<Record<Workspace, string>>;
  /** This window's workspace (`?ws=` in the URL, else that of the last active tab). */
  workspace: Workspace;
  setWorkspace: (workspace: Workspace) => void;
  /** Pitwall panels are locked (no dragging, no buttons in their title bars) unless editing. */
  editing: boolean;
  setEditing: (editing: boolean) => void;
  add: (name: string, preset: PresetId) => void;
  /** A copy of a tab (layout and all) right after it, made active: a variant of a board. */
  duplicate: (id: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  activate: (id: string) => void;
  saveLayout: (id: string, layout: SerializedDockview) => void;
  /** Bumped to make the dashboard load the active tab's layout again. */
  reload: number;
  /** Show a saved view's layout: in its own tab, made or reused. */
  showView: (view: {
    id: number;
    name: string;
    layout: SerializedDockview | null;
    preset: PresetId;
  }) => void;
  linkView: (id: string, viewId: number | undefined) => void;
  /** Append tabs from an exported file. */
  importTabs: (tabs: Omit<DashboardTab, 'id'>[]) => void;
};

const newId = () => `dash-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Presets that play with the clock belong on the pitwall (for tabs without a workspace). */
const PITWALL_PRESETS: ReadonlySet<PresetId> = new Set(['pitwall', 'replay']);

export function tabWorkspace(tab: DashboardTab): Workspace {
  return tab.workspace ?? (PITWALL_PRESETS.has(tab.preset) ? 'pitwall' : 'analysis');
}

/** The tab a workspace starts with. */
function defaultTab(workspace: Workspace): DashboardTab {
  return workspace === 'pitwall'
    ? { id: newId(), name: 'Pitwall', layout: null, preset: 'pitwall', workspace }
    : { id: newId(), name: 'Analysis', layout: null, preset: 'quali-duel', workspace };
}

function urlWorkspace(): Workspace | null {
  try {
    const ws = new URLSearchParams(window.location.search).get('ws');
    return ws === 'analysis' || ws === 'pitwall' ? ws : null;
  } catch {
    return null;
  }
}

/** Keep the workspace in the URL, so a reload (or this window's second screen) stays on it. */
function writeUrlWorkspace(workspace: Workspace) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('ws', workspace);
    window.history.replaceState(window.history.state, '', url);
  } catch {
    // not in a browser
  }
}

type Stored = Pick<DashboardsState, 'tabs' | 'active' | 'actives' | 'workspace'>;

/** Every tab gets a workspace, `workspace` gets at least one tab, and `active` is one of them. */
function settle(state: Stored, workspace: Workspace): Stored {
  let tabs = state.tabs.map((t) => (t.workspace ? t : { ...t, workspace: tabWorkspace(t) }));
  const own = tabs.filter((t) => t.workspace === workspace);
  if (own.length === 0) {
    const tab = defaultTab(workspace);
    tabs = [...tabs, tab];
    own.push(tab);
  }
  const remembered = state.actives[workspace];
  const active = own.some((t) => t.id === remembered)
    ? remembered!
    : own.some((t) => t.id === state.active)
      ? state.active
      : own[0].id;
  return { tabs, workspace, active, actives: { ...state.actives, [workspace]: active } };
}

/** The single layout of earlier versions becomes the first tab. */
function initialTabs(): DashboardTab[] {
  let layout: SerializedDockview | null = null;
  try {
    const raw = localStorage.getItem('f1dash-layout-v1');
    if (raw) layout = JSON.parse(raw) as SerializedDockview;
  } catch {
    // Unreadable old layout: start from the preset.
  }
  return [{ id: newId(), name: 'Analysis', layout, preset: 'quali-duel', workspace: 'analysis' }];
}

const tabs = initialTabs();
const first = settle(
  { tabs, active: tabs[0].id, actives: {}, workspace: 'analysis' },
  urlWorkspace() ?? 'analysis'
);

export const useDashboards = create<DashboardsState>()(
  persist(
    (set) => ({
      ...first,
      setWorkspace: (workspace) => {
        writeUrlWorkspace(workspace);
        set((s) => (s.workspace === workspace ? s : { ...settle(s, workspace), editing: false }));
      },
      editing: false,
      setEditing: (editing) => set({ editing }),
      add: (name, preset) =>
        set((s) => {
          const tab = { id: newId(), name, layout: null, preset, workspace: s.workspace };
          return {
            tabs: [...s.tabs, tab],
            active: tab.id,
            actives: { ...s.actives, [s.workspace]: tab.id },
          };
        }),
      duplicate: (id) =>
        set((s) => {
          const at = s.tabs.findIndex((t) => t.id === id);
          if (at < 0) return s;
          const { viewId: _view, ...original } = s.tabs[at];
          const tab = { ...original, id: newId(), name: `${original.name} 2` };
          return {
            tabs: [...s.tabs.slice(0, at + 1), tab, ...s.tabs.slice(at + 1)],
            active: tab.id,
            actives: { ...s.actives, [s.workspace]: tab.id },
          };
        }),
      rename: (id, name) =>
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, name } : t)) })),
      remove: (id) =>
        set((s) => {
          const own = s.tabs.filter((t) => tabWorkspace(t) === s.workspace);
          if (own.length <= 1) return s;
          const at = own.findIndex((t) => t.id === id);
          const rest = own.filter((t) => t.id !== id);
          const active = s.active === id ? rest[Math.max(0, at - 1)].id : s.active;
          return {
            tabs: s.tabs.filter((t) => t.id !== id),
            active,
            actives: { ...s.actives, [s.workspace]: active },
          };
        }),
      activate: (id) => set((s) => ({ active: id, actives: { ...s.actives, [s.workspace]: id } })),
      saveLayout: (id, layout) =>
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, layout } : t)) })),
      reload: 0,
      showView: ({ id: viewId, name, layout, preset }) =>
        set((s) => {
          const existing = s.tabs.find((t) => t.viewId === viewId);
          if (!existing) {
            const tab = { id: newId(), name, layout, preset, viewId, workspace: s.workspace };
            return {
              tabs: [...s.tabs, tab],
              active: tab.id,
              actives: { ...s.actives, [s.workspace]: tab.id },
            };
          }
          // A view opens in this window's workspace.
          return {
            tabs: s.tabs.map((t) =>
              t.id === existing.id ? { ...t, layout, preset, workspace: s.workspace } : t
            ),
            active: existing.id,
            actives: { ...s.actives, [s.workspace]: existing.id },
            reload: s.reload + 1,
          };
        }),
      linkView: (id, viewId) =>
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, viewId } : t)) })),
      importTabs: (imported) =>
        set((s) => {
          const tabs = imported.map((t) => ({
            ...t,
            id: newId(),
            workspace: tabWorkspace(t as DashboardTab),
          }));
          const here = tabs.find((t) => t.workspace === s.workspace);
          return tabs.length
            ? {
                tabs: [...s.tabs, ...tabs],
                ...(here
                  ? { active: here.id, actives: { ...s.actives, [s.workspace]: here.id } }
                  : {}),
              }
            : s;
        }),
    }),
    {
      name: 'f1dash-dashboards',
      partialize: ({ tabs, active, actives }) => ({ tabs, active, actives }),
      // Older stores have no workspaces: the preset of each tab decides, and this window opens
      // where the last active tab was (unless the URL says otherwise).
      merge: (persisted, current) => {
        const stored = { ...current, ...(persisted as Partial<Stored>) };
        const actives = stored.actives ?? {};
        const last = stored.tabs.find((t) => t.id === stored.active);
        const workspace = urlWorkspace() ?? (last ? tabWorkspace(last) : current.workspace);
        return { ...current, ...settle({ ...stored, actives }, workspace) };
      },
    }
  )
);
