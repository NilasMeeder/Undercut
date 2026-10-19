import type { DeletedLap, Incident, Penalty, Stewarding } from '@/api/client';

type Status = Incident['status'];

/** Track-limits strikes in a race: the third gives the black-and-white flag, the next a penalty. */
export const STRIKES_FOR_FLAG = 3;

/** What one driver has against him at a moment. */
export type DriverRecord = {
  driver: string;
  /** Deleted laps for track limits. */
  strikes: DeletedLap[];
  /** Deleted for something else (a double yellow). */
  otherDeleted: DeletedLap[];
  blackAndWhite: boolean;
  penalties: (Penalty & { servedNow: boolean })[];
  /** Incidents with him that are noted or under investigation (not decided). */
  pending: number;
};

export type IncidentNow = {
  incident: Incident;
  status: Status;
  /** When it was first noted, and when it last changed. */
  since: number | null;
  changed: number | null;
  /** The decision's text, once decided ('5 SECOND TIME PENALTY'). */
  decision: string | null;
};

const PENDING: ReadonlySet<Status> = new Set(['noted', 'investigating', 'after']);
const done = (time: number | null | undefined, t: number) => time == null || time <= t;

/** The incidents as they stood at `t`, newest change first. */
export function incidentsAt(data: Stewarding, t: number): IncidentNow[] {
  const out: IncidentNow[] = [];
  for (const incident of data.incidents) {
    const events = incident.events.filter((e) => done(e.time, t));
    if (events.length === 0) continue;
    const last = events[events.length - 1];
    const decisions = events.filter((e) => e.status === 'penalty' || e.status === 'reprimand');
    out.push({
      incident,
      status: last.status,
      since: events[0].time,
      changed: last.time,
      decision: decisions.length
        ? decisions.map((e) => `${e.driver ?? ''} ${shortPenalty(e.text)}`.trim()).join(', ')
        : null,
    });
  }
  return out.sort((a, b) => (b.changed ?? 0) - (a.changed ?? 0));
}

/** Per driver what he has at `t`, the drivers with the most at stake first. */
export function recordsAt(data: Stewarding, t: number): DriverRecord[] {
  const records = new Map<string, DriverRecord>();
  const of = (driver: string) => {
    let r = records.get(driver);
    if (!r) {
      r = {
        driver,
        strikes: [],
        otherDeleted: [],
        blackAndWhite: false,
        penalties: [],
        pending: 0,
      };
      records.set(driver, r);
    }
    return r;
  };
  for (const lap of data.deleted) {
    if (!done(lap.time, t)) continue;
    (lap.track_limits ? of(lap.driver).strikes : of(lap.driver).otherDeleted).push(lap);
  }
  for (const flag of data.black_and_white)
    if (done(flag.time, t)) of(flag.driver).blackAndWhite = true;
  for (const p of data.penalties) {
    if (!done(p.time, t)) continue;
    of(p.driver).penalties.push({ ...p, servedNow: p.served != null && p.served <= t });
  }
  for (const now of incidentsAt(data, t))
    if (PENDING.has(now.status)) for (const d of now.incident.drivers) of(d).pending += 1;
  const weight = (r: DriverRecord) =>
    r.penalties.filter((p) => !p.servedNow && p.kind !== 'reprimand').length * 1000 +
    r.pending * 100 +
    (r.blackAndWhite ? 50 : 0) +
    r.strikes.length;
  return [...records.values()].sort((a, b) => weight(b) - weight(a));
}

/** '5 SECOND TIME PENALTY FOR CAR …' → '+5 s'; 'DRIVE THROUGH …' → 'DT'. */
export function shortPenalty(text: string): string {
  const time = /^(\d+) SECOND TIME PENALTY/.exec(text);
  if (time) return `+${time[1]} s`;
  const stopGo = /^(\d+) SECOND STOP\/GO/.exec(text);
  if (stopGo) return `SG ${stopGo[1]} s`;
  if (/^STOP-AND-GO/.test(text)) return 'SG';
  if (/^DRIVE THROUGH/.test(text)) return 'DT';
  if (/^REPRIMAND/.test(text)) return 'REPRIMAND';
  const grid = /^(\d+) PLACE GRID/.exec(text);
  if (grid) return `${grid[1]} PL GRID`;
  if (/^DISQUALIF/.test(text)) return 'DSQ';
  return text;
}

/** A penalty as a short label: '+5 s', 'DT', 'SG 10 s'. */
export function penaltyLabel(p: Penalty): string {
  switch (p.kind) {
    case 'time':
      return `+${p.seconds ?? '?'} s`;
    case 'drive_through':
      return 'DT';
    case 'stop_go':
      return p.seconds ? `SG ${p.seconds} s` : 'SG';
    case 'reprimand':
      return 'REP';
    case 'grid':
      return `${p.places ?? '?'} PL GRID`;
    case 'disqualified':
      return 'DSQ';
  }
}

export const STATUS_LABEL: Record<Status, string> = {
  noted: 'NOTED',
  investigating: 'UNDER INVESTIGATION',
  after: 'AFTER THE SESSION',
  no_investigation: 'NO INVESTIGATION',
  no_action: 'NO FURTHER ACTION',
  penalty: 'PENALTY',
  reprimand: 'REPRIMAND',
};

/** Unserved time penalties in seconds (what comes off his race time at the flag). */
export function pendingSeconds(r: DriverRecord): number {
  return r.penalties
    .filter((p) => p.kind === 'time' && !p.servedNow)
    .reduce((sum, p) => sum + (p.seconds ?? 0), 0);
}
