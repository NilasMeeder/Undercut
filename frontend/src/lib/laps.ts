import type { Lap } from '@/api/client';
import type { LapRef } from '@/store/groups';
import { attempts, bestLaps } from './timing';

/** A driver's attempts in lap order: the laps worth stepping through (no pit or cool-down laps). */
function ownAttempts(laps: Lap[], driver: string): Lap[] {
  return attempts(laps)
    .filter((l) => l.driver === driver)
    .sort((a, b) => a.lap - b.lap);
}

/** The same driver's previous or next attempt; null at either end. */
export function stepLap(laps: Lap[], from: LapRef, direction: -1 | 1): LapRef | null {
  const own = ownAttempts(laps, from.driver);
  const next =
    direction > 0 ? own.find((l) => l.lap > from.lap) : own.findLast((l) => l.lap < from.lap);
  return next ? { driver: next.driver, lap: next.lap } : null;
}

/** The best lap of the driver above or below in the classification (wraps around). */
export function stepDriver(laps: Lap[], from: LapRef, direction: -1 | 1): LapRef | null {
  const order = bestLaps(laps);
  if (order.length === 0) return null;
  const at = order.findIndex((l) => l.driver === from.driver);
  const next = order[(at + direction + order.length) % order.length];
  return { driver: next.driver, lap: next.lap };
}

/** The driver's attempt before the earliest one already selected, to overlay. */
export function earlierLap(laps: Lap[], selected: LapRef[], driver: string): LapRef | null {
  const mine = selected.filter((l) => l.driver === driver).map((l) => l.lap);
  if (mine.length === 0) return null;
  const before = ownAttempts(laps, driver).findLast((l) => l.lap < Math.min(...mine));
  return before ? { driver, lap: before.lap } : null;
}

/**
 * Follow: every driver's selected laps moved along so the newest is that driver's newest lap
 * finished by `t` (session time), keeping the gaps between them (VER L12 + L11 → L13 + L12; VER
 * L12 + NOR L12 → L13 + L13). A driver without a finished lap yet stays where he is. Returns
 * `selected` itself when nothing moves.
 */
export function followLatest(laps: Lap[], selected: LapRef[], t: number): LapRef[] {
  const newest = new Map<string, number>();
  for (const l of laps) {
    if (l.end_time == null || l.end_time > t) continue;
    newest.set(l.driver, Math.max(newest.get(l.driver) ?? 0, l.lap));
  }
  const shift = new Map<string, number>();
  for (const ref of selected) {
    const latest = newest.get(ref.driver);
    if (latest == null) continue;
    const top = Math.max(...selected.filter((s) => s.driver === ref.driver).map((s) => s.lap));
    shift.set(ref.driver, latest - top);
  }
  if ([...shift.values()].every((s) => s === 0)) return selected;
  const moved: LapRef[] = [];
  for (const ref of selected) {
    const lap = ref.lap + (shift.get(ref.driver) ?? 0);
    if (lap >= 1 && !moved.some((m) => m.driver === ref.driver && m.lap === lap)) {
      moved.push({ driver: ref.driver, lap });
    }
  }
  return moved;
}
