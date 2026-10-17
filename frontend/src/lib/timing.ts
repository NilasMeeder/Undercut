import type { DriverInfo, Lap } from '@/api/client';
import { DASHES } from './colors';
import type { LapRef } from '@/store/groups';

/** Timing class as on a timing screen: overall best, personal best, or neither. */
export type TimingClass = 'best' | 'pb' | 'none';

type Field = 'lap_time' | 'sector_1' | 'sector_2' | 'sector_3';
export const SECTORS = ['sector_1', 'sector_2', 'sector_3'] as const;
const FIELDS: Field[] = ['lap_time', ...SECTORS];

/** A lap counts for bests when it was not deleted by the stewards. */
export function countsForBests(lap: Lap): boolean {
  return !lap.deleted;
}

export type Bests = {
  overall: Record<Field, number | null>;
  personal: Map<string, Record<Field, number | null>>;
};

export function computeBests(laps: Lap[]): Bests {
  const overall: Record<Field, number | null> = {
    lap_time: null,
    sector_1: null,
    sector_2: null,
    sector_3: null,
  };
  const personal = new Map<string, Record<Field, number | null>>();
  for (const lap of laps) {
    if (!countsForBests(lap)) continue;
    let mine = personal.get(lap.driver);
    if (!mine) {
      mine = { lap_time: null, sector_1: null, sector_2: null, sector_3: null };
      personal.set(lap.driver, mine);
    }
    for (const field of FIELDS) {
      const value = lap[field];
      if (value == null) continue;
      if (mine[field] == null || value < mine[field]) mine[field] = value;
      if (overall[field] == null || value < overall[field]) overall[field] = value;
    }
  }
  return { overall, personal };
}

export function classify(lap: Lap, field: Field, bests: Bests): TimingClass {
  const value = lap[field];
  if (value == null || !countsForBests(lap)) return 'none';
  if (value === bests.overall[field]) return 'best';
  if (value === bests.personal.get(lap.driver)?.[field]) return 'pb';
  return 'none';
}

export const TIMING_TEXT: Record<TimingClass, string> = {
  best: 'text-best',
  pb: 'text-pb',
  none: 'text-text',
};

/** Each driver's quickest lap that counts, fastest first (the classification). */
export function bestLaps(laps: Lap[]): Lap[] {
  const best = new Map<string, Lap>();
  for (const lap of laps) {
    if (lap.lap_time == null || !countsForBests(lap)) continue;
    const current = best.get(lap.driver);
    if (!current || lap.lap_time < current.lap_time!) best.set(lap.driver, lap);
  }
  return [...best.values()].sort((a, b) => a.lap_time! - b.lap_time!);
}

export type LapStyle = { color: string; dash: number[] | undefined; label: string };

/**
 * Line style per selected lap: the team colour, dashed when that colour is already taken by an
 * earlier lap (teammates, or two laps of the same driver), so identity is never colour alone.
 */
export function lapStyles(laps: LapRef[], drivers: DriverInfo[] | undefined): LapStyle[] {
  const seen = new Map<string, number>();
  return laps.map((lap) => {
    const color = drivers?.find((d) => d.code === lap.driver)?.color ?? '#a0a0aa';
    const count = seen.get(color) ?? 0;
    seen.set(color, count + 1);
    return { color, dash: DASHES[count % DASHES.length], label: `${lap.driver} L${lap.lap}` };
  });
}
