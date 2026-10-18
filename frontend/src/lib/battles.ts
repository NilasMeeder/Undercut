import type { DriverRace, RaceHistory } from '@/api/client';
import { orderAt } from './strategy';

/** Seconds: within this of the car ahead it can attack (DRS until 2025, overtake mode in 2026). */
export const ATTACK = 1.0;
/** Seconds per lap: closing slower than this is not catching. */
const CLOSING = 0.05;

export type Battle = {
  ahead: DriverRace;
  behind: DriverRace;
  /** Position of the car behind. */
  position: number;
  /** Seconds between them at the line of the car behind's last lap; null when unknown or when
   * the order changed since (a pit stop in progress). */
  interval: number | null;
  /** Seconds per lap the car behind gained over the window (+ = closing); null with a pit stop or
   * SC lap in it. */
  trend: number | null;
  /** Mean clean lap time over the window, ahead and behind. */
  pace: [number | null, number | null];
  /** Laps until the car behind is within ATTACK, at the trend (0 = already). */
  attackIn: number | null;
  /** Laps until it would be on the car ahead. */
  catchIn: number | null;
  lapsLeft: number | null;
};

function gapAt(driver: DriverRace, lap: number): number | null {
  const i = driver.laps.indexOf(lap);
  return i < 0 ? null : (driver.gap[i] ?? null);
}

function cleanAt(driver: DriverRace, lap: number): boolean {
  const i = driver.laps.indexOf(lap);
  return i >= 0 && driver.clean[i] === true;
}

function meanPace(driver: DriverRace, from: number, to: number): number | null {
  const times = driver.laps.flatMap((lap, i) =>
    lap > from && lap <= to && driver.clean[i] && driver.lap_time[i] != null
      ? [driver.lap_time[i]!]
      : []
  );
  return times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
}

/** Every pair of cars next to each other in the running order at t, over the last `window` laps. */
export function battles(history: RaceHistory, t: number, window: number): Battle[] {
  const order = orderAt(history, t).filter((o) => o.done > 0);
  const leaderLaps = order[0]?.done ?? 0;
  const lapsLeft = history.total_laps != null ? history.total_laps - leaderLaps : null;
  const out: Battle[] = [];
  for (let k = 1; k < order.length; k++) {
    const ahead = order[k - 1].driver;
    const behind = order[k].driver;
    const lap = behind.laps[order[k].done - 1];
    const now = [gapAt(ahead, lap), gapAt(behind, lap)];
    // Negative: the order changed since that line (a stop in progress), it says nothing yet.
    const raw = now[0] != null && now[1] != null ? now[1] - now[0] : null;
    const interval = raw != null && raw >= 0 ? raw : null;
    const before = lap - window;
    const then = [gapAt(ahead, before), gapAt(behind, before)];
    let trend: number | null = null;
    const clean = Array.from({ length: window }, (_, i) => lap - i).every(
      (l) => cleanAt(ahead, l) && cleanAt(behind, l)
    );
    if (interval != null && then[0] != null && then[1] != null && clean) {
      trend = (then[1] - then[0] - interval) / window;
    }
    let attackIn: number | null = null;
    let catchIn: number | null = null;
    if (interval != null) {
      if (interval <= ATTACK) attackIn = 0;
      else if (trend != null && trend > CLOSING) attackIn = Math.ceil((interval - ATTACK) / trend);
      if (trend != null && trend > CLOSING) catchIn = Math.ceil(interval / trend);
    }
    out.push({
      ahead,
      behind,
      position: k + 1,
      interval,
      trend,
      pace: [meanPace(ahead, before, lap), meanPace(behind, before, lap)],
      attackIn,
      catchIn,
      lapsLeft,
    });
  }
  return out;
}
