import type { PositionTrack } from '@/api/queries';
import type { Circuit, SessionTimeline, TrackStatus } from '@/api/client';

export type CarPosition = { x: number; y: number; progress: number };

/** Seconds a car stays at the last point of the track when the clock is past it. */
const LIVE_HOLD = 3;

/**
 * A car at session time t, interpolated between the 4 Hz samples of the position track. Null when
 * the car is not on track (garage, retired, before its first lap).
 */
export function carAt(track: PositionTrack, car: number, t: number): CarPosition | null {
  let f = (t - track.start) / track.step;
  // Live, the clock can be a moment ahead of the newest point: hold it there briefly.
  if (f >= track.count - 1 && f < track.count - 1 + LIVE_HOLD / track.step) f = track.count - 1;
  const i = Math.floor(f);
  if (i < 0 || i >= track.count) return null;
  const { x, y, progress } = track.cars[car];
  const j = Math.min(i + 1, track.count - 1);
  const [hasI, hasJ] = [!Number.isNaN(x[i]), !Number.isNaN(x[j])];
  // At the edge of the data (the start, the garage) use the one sample there is.
  if (!hasI || !hasJ) {
    const k = hasI ? i : hasJ ? j : -1;
    return k < 0 ? null : { x: x[k], y: y[k], progress: progress[k] };
  }
  const w = f - i;
  // Progress jumps from just under n to n at the line; never blend across it backwards.
  const p =
    progress[j] >= progress[i] ? progress[i] + w * (progress[j] - progress[i]) : progress[i];
  return { x: x[i] + w * (x[j] - x[i]), y: y[i] + w * (y[j] - y[i]), progress: p };
}

/** Session time as h:mm:ss (or m:ss under an hour). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

/** F1's session clock at `t` (time remaining, and whether it runs), or null without one. Before
 * the first point the clock stands at that point's time. */
export function sessionClockAt(
  clock: SessionTimeline['clock'],
  t: number
): { remaining: number; running: boolean } | null {
  if (clock.length === 0) return null;
  const point = clock.findLast((p) => p.t <= t);
  if (!point) return { remaining: clock[0].remaining, running: false };
  const remaining = point.running ? point.remaining - (t - point.t) : point.remaining;
  return { remaining: Math.max(0, remaining), running: point.running && remaining > 0 };
}

export const TRACK_STATUS_LABEL: Record<TrackStatus, string> = {
  green: 'GREEN',
  yellow: 'YELLOW',
  sc: 'SAFETY CAR',
  vsc: 'VSC',
  vsc_ending: 'VSC ENDING',
  red: 'RED FLAG',
  chequered: 'CHEQUERED',
};

/** The two pit stops RaceX draws: under green flag and under a safety car. */
export type GhostKind = { label: 'PIT' | 'SC'; loss: number };

export function ghostKinds(circuit: Circuit | undefined): GhostKind[] {
  if (!circuit?.pit_loss) return [];
  const kinds: GhostKind[] = [{ label: 'PIT', loss: circuit.pit_loss }];
  if (circuit.pit_loss_sc) kinds.push({ label: 'SC', loss: circuit.pit_loss_sc });
  return kinds;
}

/**
 * Where car `i` would be now had it made a pit stop costing `loss` seconds: its own position
 * `loss` seconds ago. `position` is where it would rejoin: behind every car further along now.
 */
export function pitGhost(
  track: PositionTrack,
  i: number,
  t: number,
  loss: number,
  now: (CarPosition | null)[]
): (CarPosition & { position: number }) | null {
  if (!now[i]) return null;
  const ghost = carAt(track, i, t - loss);
  if (!ghost) return null;
  const ahead = now.filter((car, j) => j !== i && car && car.progress > ghost.progress).length;
  return { ...ghost, position: ahead + 1 };
}

/** Look this far back for a time gap; beyond it the tower's gap stands. */
const GAP_SEARCH = 150;

/**
 * The time gap on track at t: seconds since car `front` was where car `back` is now, from the
 * position track (so it moves every frame, not only at the timing lines). Null when either car is
 * off the track, `front` is not ahead in lap progress, or it was there more than GAP_SEARCH ago.
 */
export function timeGap(
  track: PositionTrack,
  front: number,
  back: number,
  t: number
): number | null {
  const target = carAt(track, back, t)?.progress;
  const head = carAt(track, front, t)?.progress;
  if (target == null || head == null || head < target) return null;
  const p = track.cars[front].progress;
  let i = Math.min(Math.floor((t - track.start) / track.step), track.count - 1);
  const stop = Math.max(1, i - Math.ceil(GAP_SEARCH / track.step));
  for (; i >= stop; i--) {
    const [a, b] = [p[i - 1], p[i]];
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    if (a <= target && target <= b) {
      const at = track.start + (i - 1 + (b > a ? (target - a) / (b - a) : 1)) * track.step;
      return Math.max(0, t - at);
    }
  }
  return null;
}
