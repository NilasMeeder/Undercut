import type { OvertakeCheck, OvertakeChecks } from '@/api/client';

/** Every driver's passages of the detection line, in time order. */
export type OvertakeIndex = Map<string, OvertakeCheck[]>;

export function overtakeIndex(data: OvertakeChecks | undefined): OvertakeIndex {
  const index: OvertakeIndex = new Map();
  for (const check of data?.checks ?? []) {
    const own = index.get(check.driver);
    if (own) own.push(check);
    else index.set(check.driver, [check]);
  }
  return index;
}

/** The driver's last passage of the detection line at or before `t`, or null. */
export function lastCheck(index: OvertakeIndex, driver: string, t: number): OvertakeCheck | null {
  const own = index.get(driver);
  if (!own || own.length === 0 || own[0].time > t) return null;
  let lo = 0;
  let hi = own.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (own[mid].time <= t) lo = mid;
    else hi = mid - 1;
  }
  return own[lo];
}

/**
 * Whether the driver has overtake mode at `t`: within 1 s of the car ahead at his last passage
 * of the detection line, with race control's overtake mode enabled then and still now (a safety
 * car disables it). It lasts until his next passage.
 */
export function hasOvertake(
  index: OvertakeIndex,
  enabled: { start: number; end: number | null }[],
  driver: string,
  t: number
): OvertakeCheck | null {
  const check = lastCheck(index, driver, t);
  if (!check || !check.enabled || !check.within) return null;
  const on = enabled.some((p) => p.start <= t && (p.end == null || t < p.end));
  return on ? check : null;
}

/** 'Within 0.42 s of NOR at the detection line (lap 23)'. */
export function describeCheck(check: OvertakeCheck): string {
  const gap = check.gap == null ? '' : ` ${check.gap.toFixed(2)} s`;
  return `Overtake mode: within${gap} of ${check.ahead ?? 'the car ahead'} at the detection line (lap ${check.lap})`;
}
