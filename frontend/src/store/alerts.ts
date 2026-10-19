import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ALERT_KINDS, type AlertKind } from '@/lib/alerts';

/** Alerts on the pitwall: on or off, which kinds, and for which cars. */
type AlertsState = {
  on: boolean;
  kinds: Record<AlertKind, boolean>;
  /** The per-car kinds (deleted laps, gaps, overtake mode, passes) for every car, not only the
   * drivers in the link groups. */
  allCars: boolean;
  setOn: (on: boolean) => void;
  setKind: (kind: AlertKind, on: boolean) => void;
  setAllCars: (all: boolean) => void;
};

const allKinds = () =>
  Object.fromEntries(ALERT_KINDS.map((k) => [k.id, true])) as Record<AlertKind, boolean>;

export const useAlerts = create<AlertsState>()(
  persist(
    (set) => ({
      on: true,
      kinds: allKinds(),
      allCars: false,
      setOn: (on) => set({ on }),
      setKind: (kind, on) => set((s) => ({ kinds: { ...s.kinds, [kind]: on } })),
      setAllCars: (allCars) => set({ allCars }),
    }),
    {
      name: 'f1dash-alerts',
      // A kind added later is on.
      merge: (saved, current) => {
        const s = (saved ?? {}) as Partial<AlertsState>;
        return { ...current, ...s, kinds: { ...allKinds(), ...s.kinds } };
      },
    }
  )
);
