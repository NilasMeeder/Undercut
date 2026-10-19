/**
 * A lap's telemetry as levels along the track map: speed, throttle and brake, or gear. Each
 * level is an opacity of the lap's own colour (as Corner phases), so a lap keeps its identity
 * and no channel needs colours of its own.
 */
import { FULL_THROTTLE } from './phases';

export type TrackChannel = 'speed' | 'throttle' | 'gear';

/** Under this much throttle (%) without brake a car is rolling (as lib/phases). */
const COAST = 10;
/** Opacity per phase, as Corner phases: braking strongest, full throttle the bare track. */
export const THROTTLE_LEVELS = [
  { label: 'brake', opacity: 1 },
  { label: 'roll', opacity: 0.5 },
  { label: 'part', opacity: 0.22 },
  { label: 'full', opacity: 0 },
] as const;
/** Speed in this many equal bands between the slowest and fastest point of the laps shown. */
export const SPEED_BANDS = 6;
const FAINTEST = 0.18;

/** A stretch of grid points [from, to] at one level. */
export type LevelRun = { level: number; from: number; to: number };

type LapChannels = { speed: number[]; throttle: number[]; brake: number[]; gear: number[] };

/** The opacity of level `level` of a channel (0 = nothing drawn). */
export function levelOpacity(channel: TrackChannel, level: number): number {
  if (channel === 'throttle') return THROTTLE_LEVELS[level]?.opacity ?? 0;
  const steps = channel === 'gear' ? 8 : SPEED_BANDS;
  return FAINTEST + ((1 - FAINTEST) * (level - 1)) / (steps - 1);
}

/** The speed range of the laps shown, for the bands. */
export function speedRange(laps: { speed: number[] }[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const lap of laps)
    for (const v of lap.speed) {
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  return Number.isFinite(lo) ? [lo, hi] : [0, 1];
}

/** The level of each grid point: throttle 0–3 (brake, roll, part, full), gear 1–8, speed 1–6. */
export function levels(
  channel: TrackChannel,
  lap: LapChannels,
  [lo, hi]: [number, number]
): number[] {
  if (channel === 'throttle')
    return lap.throttle.map((t, i) =>
      lap.brake[i] > 0 ? 0 : t >= FULL_THROTTLE ? 3 : t < COAST ? 1 : 2
    );
  if (channel === 'gear') return lap.gear.map((g) => Math.min(Math.max(Math.round(g), 1), 8));
  const span = hi - lo || 1;
  return lap.speed.map((v) =>
    Math.min(SPEED_BANDS, Math.max(1, Math.floor(((v - lo) / span) * SPEED_BANDS) + 1))
  );
}

/** Consecutive grid points at the same level as runs; each run ends on the next one's first
 * point, so the path has no gaps. */
export function levelRuns(values: number[]): LevelRun[] {
  const runs: LevelRun[] = [];
  for (let i = 0; i < values.length; i++) {
    const last = runs.at(-1);
    if (last && last.level === values[i]) last.to = i;
    else {
      if (last) last.to = i;
      runs.push({ level: values[i], from: i, to: i });
    }
  }
  return runs;
}

/** The lowest gear between grid points `from` and `to`, and where (the slowest point). */
export function cornerGear(
  lap: { speed: number[]; gear: number[] },
  from: number,
  to: number
): { gear: number; at: number } | null {
  let slowest = -1;
  for (let i = from; i <= to && i < lap.speed.length; i++) {
    if (!Number.isFinite(lap.speed[i])) continue;
    if (slowest < 0 || lap.speed[i] < lap.speed[slowest]) slowest = i;
  }
  if (slowest < 0) return null;
  let gear = Infinity;
  for (let i = from; i <= to && i < lap.gear.length; i++) gear = Math.min(gear, lap.gear[i]);
  return Number.isFinite(gear) ? { gear, at: slowest } : null;
}
