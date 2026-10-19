import type { ComparedLap, CornerLap } from '@/api/client';

/**
 * Smallest differences worth naming. Telemetry is sampled at ~4 Hz, so at 300 km/h two samples are
 * ~20 m apart: a brake point that differs by a few metres is noise, not a driving difference.
 */
export const THRESHOLDS = { brake: 10, throttle: 10, minSpeed: 3, topSpeed: 3, level: 0.02 };

export type Cause = {
  text: string;
  /** The same as a noun phrase, for "despite …". */
  despite: string;
  /** True when this difference makes the lap quicker than the reference. */
  helps: boolean;
  /** Size relative to its threshold, to rank causes against each other. */
  weight: number;
};

/** Differences between a lap and the reference through one corner, biggest first. */
export function cornerCauses(ref: CornerLap, lap: CornerLap): Cause[] {
  const causes: Cause[] = [];
  const add = (diff: number, threshold: number, text: string, helps: boolean, despite = text) => {
    if (Math.abs(diff) >= threshold)
      causes.push({ text, despite, helps, weight: Math.abs(diff) / threshold });
  };
  if (ref.brake_at != null && lap.brake_at != null) {
    const d = lap.brake_at - ref.brake_at;
    const where = `${Math.abs(d).toFixed(0)} m ${d > 0 ? 'later' : 'earlier'}`;
    add(d, THRESHOLDS.brake, `brakes ${where}`, d > 0, `braking ${where}`);
  }
  const min = lap.min_speed - ref.min_speed;
  add(
    min,
    THRESHOLDS.minSpeed,
    `${Math.abs(min).toFixed(0)} km/h ${min > 0 ? 'more' : 'less'} minimum speed`,
    min > 0
  );
  if (ref.throttle_at != null && lap.throttle_at != null) {
    const d = lap.throttle_at - ref.throttle_at;
    add(
      d,
      THRESHOLDS.throttle,
      `full throttle ${Math.abs(d).toFixed(0)} m ${d < 0 ? 'earlier' : 'later'}`,
      d < 0
    );
  }
  const top = lap.top_speed - ref.top_speed;
  add(
    top,
    THRESHOLDS.topSpeed,
    `${Math.abs(top).toFixed(0)} km/h ${top > 0 ? 'higher' : 'lower'} top speed`,
    top > 0
  );
  return causes.sort((a, b) => b.weight - a.weight);
}

/** "NOR loses 0.141 s to VER in T1–2: brakes 10 m earlier, despite 2 km/h more minimum speed." */
export function explainCorner(
  name: string,
  refName: string,
  corner: string,
  ref: CornerLap,
  lap: CornerLap
): string {
  const dt = lap.time - ref.time;
  if (Math.abs(dt) < THRESHOLDS.level) return `${name} matches ${refName} in ${corner}.`;
  const gains = dt < 0;
  const head = `${name} ${gains ? 'gains' : 'loses'} ${Math.abs(dt).toFixed(3)} s ${gains ? 'on' : 'to'} ${refName} in ${corner}`;
  const causes = cornerCauses(ref, lap);
  const why = causes.filter((c) => c.helps === gains).slice(0, 2);
  const despite = causes.find((c) => c.helps !== gains);
  if (why.length === 0) return `${head}; no single cause stands out in the data.`;
  return `${head}: ${why.map((c) => c.text).join(', ')}${despite ? `, despite ${despite.despite}` : ''}.`;
}

/** A difference for a corner table: "10 m later", faint under its threshold, "=" when level. */
export function diffCell(
  diff: number | null,
  threshold: number,
  unit: string,
  positive: string,
  negative: string
) {
  if (diff == null) return { text: '', faint: true };
  const rounded = Math.round(Math.abs(diff));
  if (rounded === 0) return { text: '=', faint: true };
  return {
    text: `${rounded} ${unit} ${diff > 0 ? positive : negative}`,
    faint: Math.abs(diff) < threshold,
  };
}

/** "107 m longer", for a lap whose telemetry is not the length of a normal lap. */
export function lengthOff(lap: ComparedLap): string | null {
  if (lap.length_off == null) return null;
  return `${Math.abs(lap.length_off).toFixed(0)} m ${lap.length_off > 0 ? 'longer' : 'shorter'}`;
}

/** Why the corners of such a lap are not compared. */
export function lengthOffNote(lap: ComparedLap): string | null {
  const off = lengthOff(lap);
  if (!off) return null;
  return (
    `${lap.driver} L${lap.lap}: the telemetry is ${off} than a normal lap (a gap in the data, ` +
    'or the pit lane), so its corners land in the wrong place. Pick another lap to compare corners.'
  );
}
