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
};

/** An automatic marker: from the session report, never stored (negative id). */
export const isAuto = (m: Pick<Marker, 'id'>) => m.id < 0;

/**
 * The session report's findings as markers: every race moment (start, quickest and slowest
 * stop, undercuts, safety car, VSC and red flag) on the clock, and for each driver where his
 * best lap loses most to the fastest as a range on that lap.
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
  for (const m of report.moments) {
    const flag = m.kind === 'flag';
    out.push({
      ...base,
      id: -(out.length + 1),
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
      id: -(out.length + 1),
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
