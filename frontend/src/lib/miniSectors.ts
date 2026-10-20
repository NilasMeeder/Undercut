import type { PositionTrack } from '@/api/queries';

/**
 * Mini-sectors for the whole field, as on the official timing screens: every sector cut into
 * pieces of about `TARGET` metres, and per car and lap the time through each piece, from the
 * position track (lap progress at 4 Hz, interpolated where it crosses a boundary). Each piece is
 * coloured when it is done, as it was at that moment: purple the quickest anyone had done there,
 * green the car's own quickest, yellow neither.
 */

/** Metres per mini-sector (F1's own are ~200–300 m). */
const TARGET = 250;
/** Lap progress that moves more than this in one grid step is a jump in the data, not driving. */
const MAX_STEP = 0.25;

export type SegmentColour = 'best' | 'pb' | 'slow';

export type Segment = { time: number; end: number; colour: SegmentColour };

export type MiniSectorLayout = {
  /** Where each mini-sector starts, as a share of the lap (the first is 0). */
  starts: number[];
  /** How many mini-sectors each timing sector has. */
  perSector: number[];
};

/**
 * Cut the lap into mini-sectors: each sector (`bounds`: where S1 and S2 end, in metres on a lap
 * of `length`) into equal pieces of about TARGET metres. Without sector bounds, the lap in thirds.
 */
export function layoutFor(bounds: number[], length: number): MiniSectorLayout {
  const edges = [0, ...(bounds.length === 2 ? bounds : [length / 3, (2 * length) / 3]), length];
  const starts: number[] = [];
  const perSector: number[] = [];
  for (let s = 0; s < 3; s++) {
    const [from, to] = [edges[s], edges[s + 1]];
    const count = Math.max(2, Math.round((to - from) / TARGET));
    perSector.push(count);
    for (let k = 0; k < count; k++) starts.push((from + ((to - from) * k) / count) / length);
  }
  return { starts, perSector };
}

/** Per car, the session time at which it crossed each mini-sector boundary; index
 * `(lap - 1) * n + k` is the start of mini-sector k of lap `lap`. NaN where unknown. */
function crossings(
  progress: Float32Array,
  count: number,
  start: number,
  step: number,
  starts: number[]
) {
  const n = starts.length;
  let top = 0;
  for (let i = 0; i < count; i++) if (progress[i] > top) top = progress[i];
  const times = new Float64Array((Math.ceil(top) + 1) * n + 1).fill(NaN);
  for (let i = 1; i < count; i++) {
    const [a, b] = [progress[i - 1], progress[i]];
    if (!(b > a) || b - a > MAX_STEP || Number.isNaN(a)) continue;
    // The first boundary after a: its lap and index, then walk up to b.
    let lap = Math.floor(a);
    let k = starts.findIndex((s) => lap + s > a);
    if (k < 0) [lap, k] = [lap + 1, 0];
    while (lap + starts[k] <= b) {
      const at = (lap + starts[k] - a) / (b - a);
      const index = lap * n + k;
      if (index >= 0 && index < times.length) times[index] = start + (i - 1 + at) * step;
      k += 1;
      if (k === n) [lap, k] = [lap + 1, 0];
    }
  }
  return times;
}

/** Per driver, per lap (1-based), the mini-sectors that car completed, coloured as they were
 * when it did. */
export type FieldSegments = Map<string, Map<number, (Segment | null)[]>>;

export function fieldSegments(track: PositionTrack, layout: MiniSectorLayout): FieldSegments {
  const n = layout.starts.length;
  type Event = { driver: string; lap: number; k: number; time: number; end: number };
  const events: Event[] = [];
  for (const car of track.cars) {
    const times = crossings(car.progress, track.count, track.start, track.step, layout.starts);
    for (let index = 0; index + 1 < times.length; index++) {
      const [from, to] = [times[index], times[index + 1]];
      if (Number.isNaN(from) || Number.isNaN(to) || to <= from) continue;
      const lap = Math.floor(index / n) + 1;
      events.push({ driver: car.driver, lap, k: index % n, time: to - from, end: to });
    }
  }
  events.sort((a, b) => a.end - b.end);

  const overall = new Array<number>(n).fill(Infinity);
  const own = new Map<string, number[]>();
  const result: FieldSegments = new Map();
  for (const e of events) {
    const mine = own.get(e.driver) ?? new Array<number>(n).fill(Infinity);
    own.set(e.driver, mine);
    const colour: SegmentColour =
      e.time <= overall[e.k] ? 'best' : e.time < mine[e.k] ? 'pb' : 'slow';
    overall[e.k] = Math.min(overall[e.k], e.time);
    mine[e.k] = Math.min(mine[e.k], e.time);
    const laps = result.get(e.driver) ?? new Map<number, (Segment | null)[]>();
    result.set(e.driver, laps);
    const row = laps.get(e.lap) ?? new Array<Segment | null>(n).fill(null);
    laps.set(e.lap, row);
    row[e.k] = { time: e.time, end: e.end, colour };
  }
  return result;
}
