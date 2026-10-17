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
