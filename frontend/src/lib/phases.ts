/**
 * The phases of a corner from the brake (on/off) and throttle channels on the comparison grid:
 * braking, rolling without throttle, part throttle, full throttle. Brake is on/off only (no
 * pressure), and the grid is 5 m on ~4 Hz data, so every edge is ±10–20 m.
 */

export type Phase = 'brake' | 'coast' | 'part' | 'full';

/** Throttle (%) from which a car counts as on full throttle (as the backend's THROTTLE_FULL). */
export const FULL_THROTTLE = 95;
/** Under this much throttle (%) without brake a car is rolling. */
const COAST = 10;

export type PhaseRun = { phase: Phase; from: number; to: number };

export type CornerPhases = {
  runs: PhaseRun[];
  /** Where braking starts and stops (the first braking run before the slowest point). */
  brakeOn: number | null;
  brakeOff: number | null;
  apex: number;
  minSpeed: number;
  /** Back on full throttle after the apex. */
  fullAt: number | null;
  /** Metres spent in each phase over the segment. */
  metres: Record<Phase, number>;
};

function phaseOf(brake: number, throttle: number): Phase {
  if (brake > 0) return 'brake';
  if (throttle >= FULL_THROTTLE) return 'full';
  return throttle < COAST ? 'coast' : 'part';
}

/** The phases of one lap between `start` and `end` (m) on the shared grid. */
export function cornerPhases(
  distance: number[],
  speed: number[],
  brake: number[],
  throttle: number[],
  start: number,
  end: number
): CornerPhases | null {
  const inside: number[] = [];
  for (let i = 0; i < distance.length; i++) {
    if (distance[i] >= start && distance[i] <= end) inside.push(i);
  }
  if (inside.length < 2) return null;
  const runs: PhaseRun[] = [];
  const metres: Record<Phase, number> = { brake: 0, coast: 0, part: 0, full: 0 };
  let slowest = inside[0];
  for (let k = 0; k < inside.length; k++) {
    const i = inside[k];
    if (speed[i] < speed[slowest]) slowest = i;
    const phase = phaseOf(brake[i], throttle[i]);
    const to = k + 1 < inside.length ? distance[inside[k + 1]] : distance[i];
    metres[phase] += to - distance[i];
    const last = runs.at(-1);
    if (last && last.phase === phase) last.to = to;
    else runs.push({ phase, from: distance[i], to });
  }
  // In a chicane the first braking phase is the one that matters (as the backend's brake_at).
  const firstBrake = runs.find((r) => r.phase === 'brake' && r.from <= distance[slowest]);
  const full = runs.find((r) => r.phase === 'full' && r.from >= distance[slowest]);
  return {
    runs,
    brakeOn: firstBrake?.from ?? null,
    brakeOff: firstBrake?.to ?? null,
    apex: distance[slowest],
    minSpeed: speed[slowest],
    fullAt: full?.from ?? null,
    metres,
  };
}
