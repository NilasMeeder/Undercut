import type { DockviewApi } from 'dockview-react';
import { create } from 'zustand';

/** The dockview API, for controls outside the dock (top bar). */
export const useDashboardApi = create<{
  api: DockviewApi | null;
  setApi: (api: DockviewApi) => void;
}>((set) => ({ api: null, setApi: (api) => set({ api }) }));
