import type {
  Lap,
  OvertakeChecks,
  Pass,
  RaceHistory,
  SessionReport,
  SessionTimeline,
  Stewarding,
  StraightMode,
} from '@/api/client';
import { formatLapTime } from './format';
import { STATUS_LABEL, penaltyLabel } from './stewards';

/** What the board can tell you about as it happens. */
export const ALERT_KINDS = [
  { id: 'flag', label: 'Safety car, VSC and red flags' },
  { id: 'fastest', label: 'Fastest lap' },
  { id: 'pit', label: 'Pit stops (races)' },
  { id: 'stewards', label: 'Stewards: investigations and penalties' },
  { id: 'deleted', label: 'Deleted laps' },
  { id: 'gap', label: 'Gap to the car ahead under 1 s (races)' },
  { id: 'ot', label: 'Overtake mode (2026 races)' },
  { id: 'pass', label: 'Passes (races)' },
  { id: 'pace', label: 'Pace changes (races)' },
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number]['id'];

/** The kinds that happen for every car many times a race: by default only for the drivers you
 * are watching (the laps in the link groups). */
export const PER_CAR: ReadonlySet<AlertKind> = new Set(['deleted', 'gap', 'ot', 'pass']);

/** Colour by meaning: purple = fastest, red = pit or a penalty or a red flag, yellow = SC/VSC or
 * an investigation, ers = overtake mode, green = the track is clear again. */
export type AlertTone = 'best' | 'pit' | 'slow' | 'ers' | 'pb' | 'plain';

export type Alert = {
  /** Stable across refreshes of live data, so one event alerts once. */
  key: string;
  kind: AlertKind;
  /** Session time (s) it happened. */
  time: number;
  /** The cars it is about (the first one leads); empty for the whole track. */
  drivers: string[];
  title: string;
  text: string;
  tone: AlertTone;
};

export type AlertSources = {
  race: boolean;
  laps?: Lap[];
  history?: RaceHistory;
  stewarding?: Stewarding;
  timeline?: SessionTimeline;
  passes?: Pass[];
  overtake?: OvertakeChecks;
  straightMode?: StraightMode;
  report?: SessionReport;
};

/** Every alert of the session in time order. */
export function buildAlerts(s: AlertSources): Alert[] {
  const out: Alert[] = [
    ...flagAlerts(s.timeline),
    ...fastestAlerts(s.laps, s.race),
    ...(s.stewarding ? stewardAlerts(s.stewarding) : []),
  ];
  if (s.race && s.history) out.push(...pitAlerts(s.history), ...gapAlerts(s.history));
  if (s.race && s.passes) out.push(...passAlerts(s.passes));
  if (s.race && s.overtake) out.push(...overtakeAlerts(s.overtake, s.straightMode));
  if (s.race && s.report) out.push(...paceAlerts(s.report));
  return out.sort((a, b) => a.time - b.time);
}

const FLAG_TITLE: Partial<Record<string, string>> = {
  sc: 'SAFETY CAR',
  vsc: 'VIRTUAL SAFETY CAR',
  vsc_ending: 'VSC ENDING',
  red: 'RED FLAG',
};

/** SC, VSC and red flag as they start, and the green after them. */
function flagAlerts(timeline: SessionTimeline | undefined): Alert[] {
  const out: Alert[] = [];
  let previous: string | null = null;
  for (const p of timeline?.track_status ?? []) {
    const title = FLAG_TITLE[p.status];
    const key = `flag:${p.status}:${Math.round(p.start)}`;
    if (title) {
      const tone = p.status === 'red' ? 'pit' : 'slow';
      const text =
        p.status === 'sc'
          ? 'Deployed'
          : p.status === 'vsc'
            ? 'Deployed: keep to the delta'
            : p.status === 'vsc_ending'
              ? 'Green when the lights go'
              : 'Session stopped';
      out.push({ key, kind: 'flag', time: p.start, drivers: [], title, text, tone });
    } else if (p.status === 'green' && previous && FLAG_TITLE[previous]) {
      out.push({
        key,
        kind: 'flag',
        time: p.start,
        drivers: [],
        title: 'GREEN',
        text: previous === 'red' ? 'The session goes on' : 'Track clear, racing again',
        tone: 'pb',
      });
    }
    if (p.status !== 'yellow') previous = p.status;
  }
  return out;
}

/** A new fastest lap of the session (not deleted). Races from lap 3: before that every lap is. */
function fastestAlerts(laps: Lap[] | undefined, race: boolean): Alert[] {
  const timed = (laps ?? [])
    .filter((l) => l.lap_time != null && l.end_time != null && !l.deleted)
    .sort((a, b) => a.end_time! - b.end_time!);
  const out: Alert[] = [];
  let best: Lap | null = null;
  for (const lap of timed) {
    if (best && lap.lap_time! >= best.lap_time!) continue;
    const previous = best;
    best = lap;
    if (!previous || (race && lap.lap < 3)) continue;
    const by = previous.lap_time! - lap.lap_time!;
    out.push({
      key: `fastest:${lap.driver}:${lap.lap}`,
      kind: 'fastest',
      time: lap.end_time!,
      drivers: [lap.driver],
      title: 'FASTEST LAP',
      text: `${formatLapTime(lap.lap_time)} L${lap.lap}, ${by.toFixed(3)} quicker${
        previous.driver === lap.driver ? '' : ` than ${previous.driver}`
      }`,
      tone: 'best',
    });
  }
  return out;
}

function stewardAlerts(data: Stewarding): Alert[] {
  const out: Alert[] = [];
  for (const incident of data.incidents) {
    const where = [incident.place, incident.reason].filter(Boolean).join(' · ');
    for (const e of incident.events) {
      // Decisions come from the penalties (with what they are), below.
      if (e.time == null || e.status === 'penalty' || e.status === 'reprimand') continue;
      out.push({
        key: `incident:${e.status}:${e.time}:${incident.drivers.join(',')}`,
        kind: 'stewards',
        time: e.time,
        drivers: incident.drivers,
        title: STATUS_LABEL[e.status],
        text: where || e.text,
        tone: e.status === 'noted' || e.status === 'investigating' ? 'slow' : 'plain',
      });
    }
  }
  for (const p of data.penalties) {
    if (p.time != null)
      out.push({
        key: `penalty:${p.driver}:${p.time}`,
        kind: 'stewards',
        time: p.time,
        drivers: [p.driver],
        title: p.kind === 'reprimand' ? 'REPRIMAND' : `PENALTY ${penaltyLabel(p)}`,
        text: p.reason || p.text,
        tone: p.kind === 'reprimand' ? 'slow' : 'pit',
      });
    if (p.served != null)
      out.push({
        key: `served:${p.driver}:${p.served}`,
        kind: 'stewards',
        time: p.served,
        drivers: [p.driver],
        title: 'PENALTY SERVED',
        text: penaltyLabel(p),
        tone: 'plain',
      });
  }
  for (const flag of data.black_and_white) {
    if (flag.time == null) continue;
    out.push({
      key: `bw:${flag.driver}:${flag.time}`,
      kind: 'stewards',
      time: flag.time,
      drivers: [flag.driver],
      title: 'BLACK AND WHITE FLAG',
      text: flag.reason,
      tone: 'slow',
    });
  }
  for (const lap of data.deleted) {
    if (lap.time == null) continue;
    out.push({
      key: `deleted:${lap.driver}:${lap.time}`,
      kind: 'deleted',
      time: lap.time,
      drivers: [lap.driver],
      title: 'LAP DELETED',
      text: [lap.lap_time, lap.lap != null ? `L${lap.lap}` : null, lap.turn?.replace('TURN ', 'T')]
        .filter(Boolean)
        .join(' · '),
      tone: 'slow',
    });
  }
  return out;
}

/** At pit exit: how long in the lane, and the tyre he goes out on. */
function pitAlerts(history: RaceHistory): Alert[] {
  const out: Alert[] = [];
  for (const d of history.drivers) {
    for (const stop of d.stops) {
      const before = d.stints.find((s) => s.start_lap <= stop.lap && stop.lap <= s.end_lap);
      const after = d.stints.find((s) => s.start_lap === stop.lap + 1);
      const tyres =
        before?.compound && after?.compound
          ? ` · ${before.compound[0]} → ${after.compound[0]}${after.fresh === false ? ' (used)' : ''}`
          : '';
      out.push({
        key: `pit:${d.driver}:${stop.lap}`,
        kind: 'pit',
        time: stop.pit_out,
        drivers: [d.driver],
        title: stop.status === 'sc' || stop.status === 'vsc' ? 'PIT STOP UNDER SC' : 'PIT STOP',
        text: `L${stop.lap} · ${stop.lane.toFixed(1)} s in the lane${tyres}`,
        tone: 'pit',
      });
    }
  }
  return out;
}

/** The car behind comes within 1 s of the one ahead at the line, from 1 s or more the lap
 * before (the same two cars, neither on a pit lap). */
function gapAlerts(history: RaceHistory): Alert[] {
  const byPosition = new Map<number, Map<number, { driver: string; line: number }>>();
  for (const d of history.drivers) {
    d.laps.forEach((lap, i) => {
      const position = d.position[i];
      const line = d.line[i];
      if (position == null || line == null) return;
      let at = byPosition.get(lap);
      if (!at) byPosition.set(lap, (at = new Map()));
      at.set(position, { driver: d.driver, line });
    });
  }
  const pitLaps = new Set(
    history.drivers.flatMap((d) =>
      d.stops.flatMap((s) => [`${d.driver}:${s.lap}`, `${d.driver}:${s.lap + 1}`])
    )
  );
  const out: Alert[] = [];
  const previous = new Map<string, { lap: number; gap: number }>();
  for (const lap of [...byPosition.keys()].sort((a, b) => a - b)) {
    const at = byPosition.get(lap)!;
    for (const [position, me] of at) {
      const ahead = at.get(position - 1);
      if (!ahead) continue;
      const gap = me.line - ahead.line;
      const pair = `${me.driver}:${ahead.driver}`;
      const was = previous.get(pair);
      previous.set(pair, { lap, gap });
      if (lap < 2 || pitLaps.has(`${me.driver}:${lap}`) || pitLaps.has(`${ahead.driver}:${lap}`))
        continue;
      if (gap > 0 && gap < 1 && was?.lap === lap - 1 && was.gap >= 1)
        out.push({
          key: `gap:${me.driver}:${lap}`,
          kind: 'gap',
          time: me.line,
          drivers: [me.driver, ahead.driver],
          title: 'WITHIN 1 S',
          text: `${gap.toFixed(3)} behind ${ahead.driver} for P${position - 1} · L${lap}`,
          tone: 'plain',
        });
    }
  }
  return out;
}

function passAlerts(passes: Pass[]): Alert[] {
  return passes.map((p) => ({
    key: `pass:${p.driver}:${p.passed}:${p.lap}`,
    kind: 'pass',
    time: p.time,
    drivers: [p.driver, p.passed],
    title: p.position != null ? `PASS FOR P${p.position}` : 'PASS',
    text: `Past ${p.passed}${p.corner ? ` into ${p.corner}` : ''} · L${p.lap}${
      p.overtake_mode ? ' · overtake mode' : ''
    }`,
    tone: 'plain',
  }));
}

/** Within 1 s at the detection line while race control has overtake mode on. */
function overtakeAlerts(data: OvertakeChecks, lines: StraightMode | undefined): Alert[] {
  const on = lines?.overtake_enabled ?? [];
  const enabled = (t: number) => on.some((p) => p.start <= t && (p.end == null || t < p.end));
  return data.checks
    .filter((c) => c.within && c.enabled && enabled(c.time))
    .map((c) => ({
      key: `ot:${c.driver}:${c.lap}`,
      kind: 'ot' as const,
      time: c.time,
      drivers: c.ahead ? [c.driver, c.ahead] : [c.driver],
      title: 'OVERTAKE MODE',
      text: `${c.gap != null ? `${c.gap.toFixed(2)} s` : 'Within 1 s'} behind ${c.ahead ?? 'the car ahead'} · L${c.lap}`,
      tone: 'ers' as const,
    }));
}

/** A driver whose pace stepped up or down (the report's pace changes), once the data shows it:
 * after the fifth lap at the new pace. */
function paceAlerts(report: SessionReport): Alert[] {
  return report.moments
    .filter((m) => m.kind === 'pace' && m.driver != null && m.value != null)
    .map((m) => {
      const step = m.value ?? 0;
      const quicker = step < 0;
      const cause = m.other ? ` · ${quicker ? 'free of' : 'behind'} ${m.other}` : '';
      return {
        key: `pace:${m.driver}:${m.lap}`,
        kind: 'pace' as const,
        time: m.known ?? m.t,
        drivers: m.other ? [m.driver!, m.other] : [m.driver!],
        title: `${quicker ? 'QUICKER' : 'SLOWER'} ${Math.abs(step).toFixed(1)} S/LAP`,
        text: `Since L${m.lap}${cause}`,
        tone: 'plain' as const,
      };
    });
}
