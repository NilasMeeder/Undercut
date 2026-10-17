import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SessionCode } from '@/api/client';

type SelectionState = {
  year: number;
  round: number | null;
  session: SessionCode | null;
  setYear: (year: number) => void;
  setRound: (round: number) => void;
  setSession: (session: SessionCode) => void;
};

export const useSelection = create<SelectionState>()(
  persist(
    (set) => ({
      year: new Date().getFullYear(),
      round: null,
      session: null,
      setYear: (year) => set({ year, round: null, session: null }),
      setRound: (round) => set({ round, session: null }),
      setSession: (session) => set({ session }),
    }),
    { name: 'f1dash-selection' }
  )
);
