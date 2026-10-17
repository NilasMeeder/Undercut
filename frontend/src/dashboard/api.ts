import { useSyncExternalStore } from 'react';
import type { DockviewApi } from 'dockview-react';
import { create } from 'zustand';
import type { GroupId } from '@/store/groups';

/** The dockview API, for controls outside the dock (top bar). */
export const useDashboardApi = create<{
  api: DockviewApi | null;
  setApi: (api: DockviewApi) => void;
}>((set) => ({ api: null, setApi: (api) => set({ api }) }));

/** Link group of the focused panel: what keyboard shortcuts and commands act on. */
export function useActiveLinkGroup(): GroupId {
  const api = useDashboardApi((s) => s.api);
  return useSyncExternalStore(
    (fn) => {
      // Layout changes include parameter changes, so switching the panel's group counts too.
      const subs = [api?.onDidActivePanelChange(fn), api?.onDidLayoutChange(fn)];
      return () => subs.forEach((s) => s?.dispose());
    },
    () => (api?.activePanel?.params as { group?: GroupId } | undefined)?.group ?? 'blue'
  );
}
