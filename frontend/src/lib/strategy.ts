import type { DriverRace, RaceHistory, SessionTimeline, Stint } from '@/api/client';
import { TRACK_STATUS_COLORS } from './colors';

/** Fuel effect choices (s per kg, 100 kg at the start); 0 = raw lap times. */
export const FUEL_OPTIONS = [
  { value: 0, label: 'Off: raw lap times' },
  { value: 0.02, label: '0.02 s/kg (~2 s over a race)' },
  { value: 0.03, label: '0.03 s/kg (~3 s over a race)' },
  { value: 0.04, label: '0.04 s/kg (~4 s over a race)' },
];
export const DEFAULT_FUEL = 0.03;

/** Laps a driver had completed at session time t. */
export function completedAt(driver: DriverRace, t: number): number {
  let n = 0;
  for (const line of driver.line) {
    if (line == null || line > t) break;
    n++;
  }
  return n;
}

/** The latest lap a driver had completed at t, or his first lap before that. */
export function latestLap(driver: DriverRace, t: number): number {
  const done = completedAt(driver, t);
  return done > 0 ? driver.laps[done - 1] : (driver.laps[0] ?? 1);
}

/** The running order at t: most laps completed first, then who completed the last one first. */
export function orderAt(history: RaceHistory, t: number): { driver: DriverRace; done: number }[] {
  return history.drivers
    .map((driver) => ({ driver, done: completedAt(driver, t) }))
    .sort((a, b) => {
      if (a.done !== b.done) return b.done - a.done;
      if (a.done === 0) return (a.driver.grid ?? 99) - (b.driver.grid ?? 99);
      return (a.driver.line[a.done - 1] ?? Infinity) - (b.driver.line[b.done - 1] ?? Infinity);
    });
}

/**
 * Where the degradation fits and the pit window are cut off at clock time t: in a race the end
 * of the leader's last completed lap, so they change once a lap; otherwise the whole minute. Null
 * at the end of the session (= everything). Until the leader's second line it is the last car
 * across the first: at the leader's first line nobody else has a gap yet, and a safety car on
 * lap 1 is when the safety car calculator matters.
 */
export function strategyCutoff(
  history: RaceHistory,
  timeline: SessionTimeline,
  t: number
): number | null {
  if (t >= timeline.end) return null;
  if (timeline.kind !== 'race') return Math.floor(t / 60) * 60;
  let cutoff = timeline.start;
  for (const end of history.leader_line) {
    if (end > t) break;
    cutoff = end;
  }
  if (cutoff === history.leader_line[0]) {
    for (const driver of history.drivers) {
      const first = driver.laps[0] === 1 ? driver.line[0] : undefined;
      if (first != null && first <= t && first > cutoff) cutoff = first;
    }
  }
  return cutoff;
}

/** The lap axis: session time → laps of the leader (2.5 = halfway through lap 3). */
export function lapAxis(history: RaceHistory, timeline: SessionTimeline): (t: number) => number {
  const ends = history.leader_line;
  const first = timeline.lap_starts[0] ?? timeline.start;
  return (t) => {
    if (t <= first) return 0;
    let start = first;
    for (let n = 0; n < ends.length; n++) {
      if (t < ends[n]) return n + (t - start) / Math.max(ends[n] - start, 1e-6);
      start = ends[n];
    }
    return ends.length;
  };
}

export type LapBand = { from: number; to: number; color: string; label: string };

const BAND_LABEL: Record<string, string> = {
  sc: 'SC',
  vsc: 'VSC',
  vsc_ending: 'VSC',
  red: 'RED',
  yellow: 'YELLOW',
};

/** Safety car, VSC and red flag periods on the lap axis. */
export function statusBands(history: RaceHistory, timeline: SessionTimeline): LapBand[] {
  const toLap = lapAxis(history, timeline);
  return timeline.track_status
    .filter((p) => p.status in BAND_LABEL)
    .map((p) => ({
      from: toLap(p.start),
      to: toLap(p.end),
      color: TRACK_STATUS_COLORS[p.status],
      label: BAND_LABEL[p.status],
    }));
}

/** The stint a lap belongs to. */
export function stintOf(driver: DriverRace, lap: number): Stint | undefined {
  return driver.stints.find((s) => s.start_lap <= lap && lap <= s.end_lap);
}

export function formatDeg(slope: number): string {
  return `${slope >= 0 ? '+' : '−'}${Math.abs(slope).toFixed(3)}`;
}
