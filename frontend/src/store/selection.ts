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

export type SessionKey = { year: number; round: number; session: SessionCode };

/** The selected session, or null while the picker is incomplete. */
export function useSessionKey(): SessionKey | null {
  const year = useSelection((s) => s.year);
  const round = useSelection((s) => s.round);
  const session = useSelection((s) => s.session);
  return round != null && session != null ? { year, round, session } : null;
}

export function sessionPath({ year, round, session }: SessionKey): string {
  return `/sessions/${year}/${round}/${session}`;
}
