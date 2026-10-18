import { useMemo, useSyncExternalStore } from 'react';
import type { Lap } from '@/api/client';
import { useLaps } from '@/api/queries';
import { atClockOn, useAtClockOn } from '@/store/atClock';
import { clock } from '@/store/clock';

/** Which laps a panel shows: as the switch in the clock bar says, always only the laps done at
 * the session clock, or always the whole session. */
export type LapScope = 'app' | 'clock' | 'session';

export const LAP_SCOPE_OPTIONS: { value: LapScope; label: string }[] = [
  { value: 'app', label: 'As the switch in the clock bar' },
  { value: 'clock', label: 'Only laps done at the clock' },
  { value: 'session', label: 'Always the whole session' },
];

/** Whether a panel with this scope shows the session up to the clock (outside React too). */
export function scopeFollowsClock(scope: LapScope, switchOn = atClockOn()): boolean {
  return scope === 'clock' || (scope === 'app' && switchOn);
}

/** How many laps are done at t (ends sorted); null with the clock at the end: all of them, also
 * laps without an end time. */
function doneAt(ends: number[]): number | null {
  const range = clock.controls().range;
  const t = clock.time();
  if (!range || t >= range[1]) return null;
  let lo = 0;
  let hi = ends.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ends[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const noSubscription = () => () => {};

/**
 * The session's laps as `useLaps`, but only those done at the session clock when `scope` says so.
 * Re-renders only when a lap is added or taken off, not on every clock tick.
 */
export function useLapsAtClock(scope: LapScope = 'app') {
  const query = useLaps();
  const switchOn = useAtClockOn();
  const applies = scopeFollowsClock(scope, switchOn);
  const ends = useMemo(
    () =>
      (query.data ?? [])
        .map((l) => l.end_time)
        .filter((e): e is number => e != null)
        .sort((a, b) => a - b),
    [query.data]
  );
  const done = useSyncExternalStore(applies ? clock.subscribe : noSubscription, () =>
    applies ? doneAt(ends) : null
  );
  const data = useMemo((): Lap[] | undefined => {
    if (!query.data || done == null) return query.data;
    const until = done > 0 ? ends[done - 1] : -Infinity;
    return query.data.filter((l) => l.end_time != null && l.end_time <= until);
  }, [query.data, ends, done]);
  return { ...query, data, cut: done != null };
}
