import { useState } from 'react';
import type { LapProgress } from '@/api/client';
import { useLapProgress, useTimeline, type ProgressReference } from '@/api/queries';
import { useClockTime } from '@/store/clock';

/** The lap is fetched this many seconds ahead of the clock and drawn up to the clock every
 * frame, so the line grows smoothly instead of a second at a time. */
const AHEAD = 2;
/** Seconds the finished lap stays after the line. */
const HOLD = 3;

type Values = (number | null)[];

/** The last grid point the car had reached `elapsed` seconds into the lap, or -1. */
export function reachedAt(time: Values, elapsed: number): number {
  for (let i = time.length - 1; i >= 0; i--) {
    const at = time[i];
    if (at != null && at <= elapsed) return i;
  }
  return -1;
}

/** Where the car is at session time `now` on a lap progress: the grid index (-1 before the
 * first point), seconds into the lap, and the delta there (null on an out-lap). */
export function progressAt(data: LapProgress, now: number) {
  const elapsed = Math.min(Math.max(now - data.start, 0), data.elapsed);
  const n = reachedAt(data.time, elapsed);
  const gap =
    data.out_lap || n < 0 ? null : (data.delta.slice(0, n + 1).findLast((v) => v != null) ?? null);
  return { n, elapsed, gap };
}

/**
 * The lap `driver` is on at the clock (backend: /lap-progress), against the previous or best
 * lap ('auto': previous in a race, else best). Until the clock is on the next lap, and a few
 * seconds after the line (its delta there is the lap time gap), the lap before, asked at its end.
 */
export function useLiveLap(driver: string | undefined, against: 'auto' | ProgressReference) {
  const t = useClockTime(250);
  const timeline = useTimeline();
  const race = timeline.data?.kind === 'race';
  const reference = against === 'auto' ? (race ? 'previous' : 'best') : against;
  const progress = useLapProgress(driver, t + AHEAD, reference);
  const latest = progress.data?.driver === driver ? progress.data : undefined;
  const holding = latest != null && t < latest.start + HOLD;
  const finished = useLapProgress(
    holding ? driver : undefined,
    (latest?.start ?? 0) - 0.001,
    reference,
    true
  ).data;
  // While that loads, whatever was on screen if it is that lap.
  const [shown, setShown] = useState<LapProgress | undefined>(undefined);
  const previous = (p: LapProgress | undefined) =>
    p != null && holding && p.driver === driver && p.lap === latest.lap - 1;
  const data = previous(finished) ? finished : previous(shown) ? shown : latest;
  if (data !== shown) setShown(data);
  return { data, error: progress.error };
}
