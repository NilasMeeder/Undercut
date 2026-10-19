import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Automatic markers (the session report's findings) shown with the stored ones, or not. */
type AutoMarkersState = { on: boolean; setOn: (on: boolean) => void };

export const useAutoMarkersOn = create<AutoMarkersState>()(
  persist((set) => ({ on: true, setOn: (on) => set({ on }) }), { name: 'f1dash-auto-markers' })
);
