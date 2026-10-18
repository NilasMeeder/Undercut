import type {
  ReportAction,
  ReportClipping,
  ReportCorner,
  ReportMoment,
  ReportRun,
  ReportStint,
} from '@/api/client';
import { formatLapTime } from './format';
import { explainCorner } from './insights';
import { formatClock } from './replay';

/** "VER:12" → { driver, lap }. */
export function parseLapRef(ref: string): { driver: string; lap: number } {
  const [driver, lap] = ref.split(':');
  return { driver, lap: Number(lap) };
}

/** What a click does, for the row's tooltip. */
export function actionTitle(action: ReportAction): string {
  const parts: string[] = [];
  if (action.laps.length > 0)
    parts.push(
      `compare ${action.laps
        .map(parseLapRef)
        .map((l) => `${l.driver} L${l.lap}`)
        .join(' and ')}`
    );
  if (action.zoom)
    parts.push(`zoom to ${Math.round(action.zoom[0])}–${Math.round(action.zoom[1])} m`);
  if (action.t != null) parts.push('put the clock there');
  return parts.length ? `Click: ${parts.join(', ')}` : '';
}

export function cornerLine(c: ReportCorner): string {
  return explainCorner(c.driver, c.reference, c.corner, c.reference_stats, c.stats);
}

const slope = (s: number) => `${s >= 0 ? '+' : '−'}${Math.abs(s).toFixed(3)} s/lap`;

export function runLine(run: ReportRun, quickest: ReportRun): string {
  const diff = run.median - quickest.median;
  const pace = run === quickest ? formatLapTime(run.median) : `+${diff.toFixed(3)}`;
  const trend = run.slope == null ? '' : `, ${slope(run.slope)}`;
  return `${run.driver} ${pace} over ${run.laps} laps (best ${formatLapTime(run.best)}${trend})`;
}

export function stintLine(s: ReportStint): string {
  const compound = s.compound ? `${s.compound.toLowerCase()}s` : 'tyres';
  return `${s.driver} on ${compound} L${s.start_lap}–${s.end_lap}: ${slope(s.slope)} over ${s.laps} laps`;
}

export function clippingLine(c: ReportClipping): string {
  return (
    `${c.driver} loses ≈${c.cost_time.toFixed(2)} s a lap to clipping (${c.reference} ` +
    `${c.reference_cost.toFixed(2)}), most into T${c.corner}: ${c.straight_cost.toFixed(2)} s.`
  );
}

const FLAG_NAMES: Record<string, string> = {
  sc: 'Safety car',
  vsc: 'Virtual safety car',
  red: 'Red flag',
};

export function momentLine(m: ReportMoment): string {
  switch (m.kind) {
    case 'start': {
      const n = Math.abs(m.value ?? 0);
      return `${m.driver} ${(m.value ?? 0) > 0 ? 'gains' : 'loses'} ${n} place${n === 1 ? '' : 's'} on lap 1.`;
    }
    case 'fast_stop':
      return `Quickest stop: ${m.driver}, ${m.value?.toFixed(1)} s in the pit lane.`;
    case 'slow_stop':
      return `Slowest stop: ${m.driver}, ${m.value?.toFixed(1)} s in the pit lane.`;
    case 'undercut':
      return `${m.driver} undercuts ${m.other}: stopped first and came out ahead.`;
    case 'flag': {
      const laps = m.until_lap != null && m.until_lap !== m.lap ? `–${m.until_lap}` : '';
      return `${FLAG_NAMES[m.status ?? ''] ?? 'Flag'} on lap ${m.lap}${laps} (${formatClock(m.value ?? 0)}).`;
    }
  }
}
