import type { Marker, SessionReport } from '@/api/client';
import type { SessionKey } from '@/store/selection';
import { cornerLine, momentLine } from './report';

/** The tag every automatic marker has: they are not stored, and the editor drops it on keep. */
export const AUTO_TAG = 'auto';

const MOMENT_TAGS: Record<string, string> = {
  start: 'start',
  fast_stop: 'pit',
  slow_stop: 'pit',
  undercut: 'undercut',
  pace: 'pace',
};

/** An automatic marker: from the session report, never stored (negative id). */
export const isAuto = (m: Pick<Marker, 'id'>) => m.id < 0;

/** A negative id from what the marker is about (FNV-1a), so it keeps its id when the report
 * comes again during a live session and finds more. */
function stableId(what: string, taken: Set<number>): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < what.length; i++) hash = Math.imul(hash ^ what.charCodeAt(i), 0x01000193);
  let id = -((hash >>> 1) + 1);
  while (taken.has(id)) id -= 1;
  taken.add(id);
  return id;
}

/**
 * The session report's findings as markers: every race moment (start, quickest and slowest
 * stop, undercuts, pace changes, safety car, VSC and red flag) and in practice every long run
 * whose pace steps on the clock, and for each driver where his best lap loses most to the
 * fastest as a range on that lap.
 */
export function autoMarkers(report: SessionReport, key: SessionKey): Marker[] {
  const base = {
    year: key.year,
    round: key.round,
    session: key.session,
    created: '1970-01-01T00:00:00Z',
    updated: '1970-01-01T00:00:00Z',
  };
  const out: Marker[] = [];
  const taken = new Set<number>();
  for (const m of report.moments) {
    const flag = m.kind === 'flag';
    out.push({
      ...base,
      id: stableId(`${m.kind}|${m.driver}|${m.other}|${m.t}`, taken),
      kind: 'time',
      start: m.t,
      end: flag && m.value ? m.t + m.value : null,
      driver: m.driver,
      lap: null,
      note: momentLine(m),
      tags: [AUTO_TAG, flag ? (m.status ?? 'flag').toUpperCase() : MOMENT_TAGS[m.kind]],
    });
  }
  for (const c of report.corners) {
    // The range Report zooms to (the corner ± 100 m, on the reference's scale).
    if (!c.action.zoom) continue;
    out.push({
      ...base,
      id: stableId(`corner|${c.driver}|${c.lap}|${c.corner}`, taken),
      kind: 'distance',
      start: Math.max(0, c.action.zoom[0]),
      end: c.action.zoom[1],
      driver: c.driver,
      lap: c.lap,
      note: cornerLine(c),
      tags: [AUTO_TAG, c.corner],
    });
  }
  return out;
}
