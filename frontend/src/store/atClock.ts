import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * The switch in the clock bar: show only what had happened at the session clock (laps, bests,
 * speed traps, run timeline), or always the whole session. Panels can override it in their
 * settings (`LapScope`). With the clock at the end, both show everything.
 */
type AtClockState = {
  on: boolean;
  setOn: (on: boolean) => void;
};

export const useAtClock = create<AtClockState>()(
  persist(
    (set) => ({
      on: true,
      setOn: (on) => set({ on }),
    }),
    { name: 'f1dash-at-clock' }
  )
);
