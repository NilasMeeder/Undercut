import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useSelection } from './selection';
import { onShared, share } from './sync';

/**
 * Link groups: every panel belongs to one. Panels in the same group share the selected laps and the
 * cursor/zoom (see cursor.ts); different groups are independent.
 */
export const GROUP_IDS = ['blue', 'orange', 'cyan', 'pink'] as const;
export type GroupId = (typeof GROUP_IDS)[number];

export const GROUP_COLORS: Record<GroupId, string> = {
  blue: '#4f8dff',
  orange: '#ff9540',
  cyan: '#2fcad8',
  pink: '#ff63ad',
};

export function nextGroup(group: GroupId): GroupId {
  return GROUP_IDS[(GROUP_IDS.indexOf(group) + 1) % GROUP_IDS.length];
}

export const MAX_LAPS_PER_GROUP = 8;

export type LapRef = { driver: string; lap: number };

export function sameLap(a: LapRef, b: LapRef): boolean {
  return a.driver === b.driver && a.lap === b.lap;
}

type GroupsState = {
  laps: Record<GroupId, LapRef[]>;
  /** The group's laps move along to each driver's newest lap at the clock (useFollowLatest).
   * Picking laps by hand stops it. */
  follow: Record<GroupId, boolean>;
  setFollow: (group: GroupId, on: boolean) => void;
  /** Set the laps while following (does not stop it). */
  followTo: (group: GroupId, laps: LapRef[]) => void;
  toggleLap: (group: GroupId, lap: LapRef) => void;
  setLaps: (group: GroupId, laps: LapRef[]) => void;
  /** Swap one lap for another in place (keeps the reference first). */
  replaceLap: (group: GroupId, from: LapRef, to: LapRef) => void;
  reset: () => void;
};

const empty = (): Record<GroupId, LapRef[]> => ({ blue: [], orange: [], cyan: [], pink: [] });
const none = (): Record<GroupId, boolean> => ({
  blue: false,
  orange: false,
  cyan: false,
  pink: false,
});

export const useGroups = create<GroupsState>()(
  persist(
    (set, get) => ({
      laps: empty(),
      follow: none(),
      setFollow: (group, on) => set((state) => ({ follow: { ...state.follow, [group]: on } })),
      followTo: (group, laps) => set((state) => ({ laps: { ...state.laps, [group]: laps } })),
      toggleLap: (group, lap) => {
        set((state) => {
          const current = state.laps[group];
          const next = current.some((l) => sameLap(l, lap))
            ? current.filter((l) => !sameLap(l, lap))
            : [...current, lap].slice(-MAX_LAPS_PER_GROUP);
          return { laps: { ...state.laps, [group]: next }, follow: stop(state, group) };
        });
        shareLaps(group, get().laps[group]);
      },
      setLaps: (group, laps) => {
        set((state) => ({
          laps: { ...state.laps, [group]: laps.slice(0, MAX_LAPS_PER_GROUP) },
          follow: stop(state, group),
        }));
        shareLaps(group, get().laps[group]);
      },
      replaceLap: (group, from, to) => {
        set((state) => {
          const current = state.laps[group];
          // Replacing with a lap that is already selected would duplicate it: drop the old one.
          const next = current.some((l) => sameLap(l, to))
            ? current.filter((l) => !sameLap(l, from))
            : current.map((l) => (sameLap(l, from) ? to : l));
          return { laps: { ...state.laps, [group]: next }, follow: stop(state, group) };
        });
        shareLaps(group, get().laps[group]);
      },
      reset: () => set({ laps: empty(), follow: none() }),
    }),
    { name: 'f1dash-groups' }
  )
);

const stop = (state: GroupsState, group: GroupId) =>
  state.follow[group] ? { ...state.follow, [group]: false } : state.follow;

// Laps picked by hand show in every window of the app (Follow moves them per window).
type SharedLaps = { group: GroupId; laps: LapRef[] };
const shareLaps = (group: GroupId, laps: LapRef[]) => share('laps', { group, laps });
onShared<SharedLaps>('laps', ({ group, laps }) =>
  useGroups.setState((state) => ({
    laps: { ...state.laps, [group]: laps },
    follow: stop(state, group),
  }))
);

export function useGroupLaps(group: GroupId): LapRef[] {
  return useGroups((s) => s.laps[group]);
}

/** Select/deselect laps of a group from a table: click a row to toggle its lap. */
export function useLapSelection(group: GroupId) {
  const selected = useGroupLaps(group);
  const toggleLap = useGroups((s) => s.toggleLap);
  return {
    isSelected: (lap: LapRef) => selected.some((s) => sameLap(s, lap)),
    toggle: (lap: LapRef) => toggleLap(group, { driver: lap.driver, lap: lap.lap }),
  };
}

// Lap selections belong to a session: clear them when the session changes.
useSelection.subscribe((state, prev) => {
  if (state.year !== prev.year || state.round !== prev.round || state.session !== prev.session) {
    useGroups.getState().reset();
  }
});
