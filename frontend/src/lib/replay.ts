import type { PositionTrack } from '@/api/queries';
import type { TrackStatus } from '@/api/client';

export type CarPosition = { x: number; y: number; progress: number };

/**
 * A car at session time t, interpolated between the 4 Hz samples of the position track. Null when
 * the car is not on track (garage, retired, before its first lap).
 */
export function carAt(track: PositionTrack, car: number, t: number): CarPosition | null {
  const f = (t - track.start) / track.step;
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

export const TRACK_STATUS_LABEL: Record<TrackStatus, string> = {
  green: 'GREEN',
  yellow: 'YELLOW',
  sc: 'SAFETY CAR',
  vsc: 'VSC',
  vsc_ending: 'VSC ENDING',
  red: 'RED FLAG',
  chequered: 'CHEQUERED',
};
