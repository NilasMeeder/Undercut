import type { Lap, TowerRow } from '@/api/client';

/**
 * Qualifying release: if a driver leaves the pit now (or in w seconds), who is around him on his
 * push lap? A forecast, also in replay: every car on track goes on at the pace of the lap it is
 * on (out-lap, push lap or cool-down), from where it is now.
 */

export type LapKind = 'out' | 'push' | 'cool';
export type Segment = { kind: LapKind; start: number; end: number };
export type CarPlan = { driver: string; kind: LapKind; crossing: number; segments: Segment[] };
export type Conflict = {
  driver: string;
  what: 'catch' | 'behind' | 'ahead';
  at: number;
  gap: number;
};

export type Paces = {
  /** Push lap per driver (his best so far), and for anyone without one. */
  push: Map<string, number>;
  pushDefault: number;
  /** Cool-down lap, pit exit to the line on an out-lap (per driver and in general). */
  cool: number;
  out: Map<string, number>;
  outDefault: number;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** A timed lap within this of the driver's best so far was a push lap. */
const PUSHED = 1.03;

/** The laps done at t give the paces: best laps, cool-downs (the lap after a push lap that is
 * not a pit lap) and out-laps (pit exit to the line). */
export function paces(laps: Lap[], t: number): Paces {
  const done = laps.filter((l) => l.end_time != null && l.end_time <= t);
  const push = new Map<string, number>();
  for (const l of done)
    if (l.lap_time != null && !l.deleted && l.lap_time < (push.get(l.driver) ?? Infinity))
      push.set(l.driver, l.lap_time);
  const best = Math.min(...push.values());
  const sessionBest = Number.isFinite(best) ? best : 90;
  const byDriver = new Map<string, Lap[]>();
  for (const l of done) byDriver.set(l.driver, [...(byDriver.get(l.driver) ?? []), l]);
  const cools: number[] = [];
  const outs = new Map<string, number[]>();
  for (const [driver, own] of byDriver) {
    own.sort((a, b) => a.lap - b.lap);
    own.forEach((l, i) => {
      if (l.pit_out && l.pit_out_time != null && l.end_time != null)
        outs.set(driver, [...(outs.get(driver) ?? []), l.end_time - l.pit_out_time]);
      const before = own[i - 1];
      if (
        before?.lap_time != null &&
        before.lap_time <= (push.get(driver) ?? 0) * PUSHED &&
        !l.pit_in &&
        !l.pit_out &&
        l.lap_time != null &&
        l.lap_time > before.lap_time * 1.15
      )
        cools.push(l.lap_time);
    });
  }
  const outMedians = new Map([...outs].map(([d, v]) => [d, median(v)]));
  const allOuts = [...outs.values()].flat();
  return {
    push,
    pushDefault: sessionBest * 1.01,
    cool: cools.length ? median(cools) : sessionBest * 1.38,
    out: outMedians,
    outDefault: allOuts.length ? median(allOuts) : sessionBest * 1.25,
  };
}

/** What a car on track does next: its lap now, then (out → push → cool) up to `horizon`. */
export function plan(
  driver: string,
  status: TowerRow['status'],
  progress: number,
  previousPush: boolean,
  t: number,
  p: Paces
): CarPlan | null {
  if (status !== 'running' && status !== 'out_lap') return null;
  const kind: LapKind = status === 'out_lap' ? 'out' : previousPush ? 'cool' : 'push';
  const pushLap = p.push.get(driver) ?? p.pushDefault;
  const duration =
    kind === 'out' ? (p.out.get(driver) ?? p.outDefault) : kind === 'push' ? pushLap : p.cool;
  const done = progress - Math.floor(progress);
  const crossing = t + (1 - done) * duration;
  const segments: Segment[] = [{ kind, start: crossing - duration, end: crossing }];
  if (kind === 'out') {
    segments.push({ kind: 'push', start: crossing, end: crossing + pushLap });
    segments.push({ kind: 'cool', start: crossing + pushLap, end: crossing + pushLap + p.cool });
  } else if (kind === 'push') {
    segments.push({ kind: 'cool', start: crossing, end: crossing + p.cool });
  }
  return { driver, kind, crossing, segments };
}

/** Seconds: a push lap starting this close behind ours is on our tail. */
export const TAIL = 2.0;
/** Seconds: a push lap this close ahead of ours: dirty air (more is a tow, which helps). */
export const AHEAD = 0.8;

/** Who is in the way of a push lap from `start` lasting `lap` seconds. `at` is the share of our
 * lap where it happens; `gap` seconds at the line (+ = they cross after us). */
export function conflicts(start: number, lap: number, cars: CarPlan[], cool: number): Conflict[] {
  const out: Conflict[] = [];
  for (const car of cars) {
    for (const s of car.segments) {
      if (s.kind === 'cool') {
        // Both at constant pace: we are at (τ − start)/lap, they at (τ − s.start)/cool.
        if (s.start >= start) continue;
        const tc = (start * cool - s.start * lap) / (cool - lap);
        if (tc >= start && tc <= start + lap && tc <= s.end)
          out.push({
            driver: car.driver,
            what: 'catch',
            at: (tc - start) / lap,
            gap: s.start - start,
          });
      } else if (s.kind === 'push') {
        const gap = s.start - start;
        if (gap > 0 && gap < TAIL) out.push({ driver: car.driver, what: 'behind', at: 0, gap });
        else if (gap <= 0 && gap > -AHEAD)
          out.push({ driver: car.driver, what: 'ahead', at: 0, gap });
      }
    }
  }
  return out;
}

/** For waits 0…horizon s (every `step`): the conflicts of leaving the pit then. */
export function releaseWindow(
  driver: string,
  t: number,
  cars: CarPlan[],
  p: Paces,
  horizon = 150,
  step = 1
): { wait: number; start: number; conflicts: Conflict[] }[] {
  const out = p.out.get(driver) ?? p.outDefault;
  const lap = p.push.get(driver) ?? p.pushDefault;
  const others = cars.filter((c) => c.driver !== driver);
  const result = [];
  for (let wait = 0; wait <= horizon; wait += step) {
    const start = t + wait + out;
    result.push({ wait, start, conflicts: conflicts(start, lap, others, p.cool) });
  }
  return result;
}
