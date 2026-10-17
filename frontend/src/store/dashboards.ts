import type { SerializedDockview } from 'dockview-react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PresetId } from '@/dashboard/layout';

/** One dashboard tab: its own dockview layout, or a preset until it is first changed. */
export type DashboardTab = {
  id: string;
  name: string;
  layout: SerializedDockview | null;
  preset: PresetId;
};

type DashboardsState = {
  tabs: DashboardTab[];
  active: string;
  add: (name: string, preset: PresetId) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  activate: (id: string) => void;
  saveLayout: (id: string, layout: SerializedDockview) => void;
  /** Append tabs from an exported file. */
  importTabs: (tabs: Omit<DashboardTab, 'id'>[]) => void;
};

const newId = () => `dash-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** The single layout of earlier versions becomes the first tab. */
function initialTabs(): DashboardTab[] {
  let layout: SerializedDockview | null = null;
  try {
    const raw = localStorage.getItem('f1dash-layout-v1');
    if (raw) layout = JSON.parse(raw) as SerializedDockview;
  } catch {
    // Unreadable old layout: start from the preset.
  }
  return [{ id: newId(), name: 'Analysis', layout, preset: 'quali-duel' }];
}

const first = initialTabs();

export const useDashboards = create<DashboardsState>()(
  persist(
    (set) => ({
      tabs: first,
      active: first[0].id,
      add: (name, preset) =>
        set((s) => {
          const tab = { id: newId(), name, layout: null, preset };
          return { tabs: [...s.tabs, tab], active: tab.id };
        }),
      rename: (id, name) =>
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, name } : t)) })),
      remove: (id) =>
        set((s) => {
          if (s.tabs.length <= 1) return s;
          const at = s.tabs.findIndex((t) => t.id === id);
          const tabs = s.tabs.filter((t) => t.id !== id);
          const active = s.active === id ? tabs[Math.max(0, at - 1)].id : s.active;
          return { tabs, active };
        }),
      activate: (id) => set({ active: id }),
      saveLayout: (id, layout) =>
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, layout } : t)) })),
      importTabs: (imported) =>
        set((s) => {
          const tabs = imported.map((t) => ({ ...t, id: newId() }));
          return tabs.length ? { tabs: [...s.tabs, ...tabs], active: tabs[0].id } : s;
        }),
    }),
    { name: 'f1dash-dashboards' }
  )
);
