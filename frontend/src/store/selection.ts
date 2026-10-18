import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SessionCode } from '@/api/client';
import { onShared, share } from './sync';

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

type Picked = Pick<SelectionState, 'year' | 'round' | 'session'>;

// The session is the same in every window of the app.
useSelection.subscribe((state, prev) => {
  if (state.year !== prev.year || state.round !== prev.round || state.session !== prev.session)
    share('session', { year: state.year, round: state.round, session: state.session });
});
onShared<Picked>('session', (picked) => useSelection.setState(picked));

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
