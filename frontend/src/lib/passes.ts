import type { OvertakeCheck, Pass } from '@/api/client';

/** Per driver over the passes up to a moment. */
export type PassTally = {
  driver: string;
  made: number;
  lost: number;
  /** Passes he made with overtake mode (2026). */
  madeWithOvertake: number;
  /** Times he got overtake mode at the detection line (2026). */
  gotOvertake: number;
};

export function tally(
  passes: Pass[],
  checks: OvertakeCheck[] | undefined,
  enabled: { start: number; end: number | null }[],
  t: number
): PassTally[] {
  const by = new Map<string, PassTally>();
  const of = (driver: string) => {
    let row = by.get(driver);
    if (!row) {
      row = { driver, made: 0, lost: 0, madeWithOvertake: 0, gotOvertake: 0 };
      by.set(driver, row);
    }
    return row;
  };
  for (const p of passes) {
    if (p.time > t) break;
    of(p.driver).made += 1;
    if (p.overtake_mode) of(p.driver).madeWithOvertake += 1;
    of(p.passed).lost += 1;
  }
  const on = (time: number) =>
    enabled.some((e) => e.start <= time && (e.end == null || time < e.end));
  for (const c of checks ?? []) {
    if (c.time > t) break;
    if (c.within && c.enabled && on(c.time)) of(c.driver).gotOvertake += 1;
  }
  return [...by.values()].sort((a, b) => b.made - b.lost - (a.made - a.lost) || b.made - a.made);
}

/** The corners with the most passes: [['T1', 18], ['T4', 9], …]. */
export function byCorner(passes: Pass[], t: number): [string, number][] {
  const counts = new Map<string, number>();
  for (const p of passes) {
    if (p.time > t) break;
    const key = p.corner ?? '–';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
