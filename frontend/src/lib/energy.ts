import type { EnergyLap, EnergyStraight } from '@/api/client';

/** Below this (s) clipping is not worth a word: the estimate is not that precise. */
export const ENERGY_LEVEL = 0.01;

/** "T11 → T1": the straight between the corner it starts from and the one it brakes for. */
export function straightLabel(straight: EnergyStraight): string {
  return `T${straight.after} → T${straight.corner}`;
}

function worst(values: (number | null)[]): number {
  let best = -1;
  values.forEach((v, i) => {
    if (v != null && (best < 0 || v > (values[best] ?? -Infinity))) best = i;
  });
  return best;
}

/** What clipping costs a lap in total, and where most. */
export function explainLap(name: string, lap: EnergyLap, straights: EnergyStraight[]): string {
  if (lap.cost_time < ENERGY_LEVEL) return `${name}: no clipping that costs a hundredth.`;
  const i = worst(lap.straights.map((s) => s?.cost_time ?? null));
  const s = lap.straights[i]!;
  const end = s.coast > 0 ? 'lift' : 'brake';
  const losing = s.superclip ? `, ${s.lost.toFixed(0)} km/h of it lost at full throttle` : '';
  return (
    `${name}: clipping costs ≈${lap.cost_time.toFixed(2)} s, most into T${straights[i].corner}: ` +
    `${s.clipped} m without gaining${losing}; ${s.cost_speed.toFixed(0)} km/h down at the ${end}.`
  );
}

/** A lap against the reference lap: who loses more to clipping, and where. */
export function compareLaps(
  refName: string,
  ref: EnergyLap,
  name: string,
  lap: EnergyLap,
  straights: EnergyStraight[]
): string | null {
  const diff = lap.cost_time - ref.cost_time;
  if (Math.abs(diff) < ENERGY_LEVEL) return null;
  const diffs = straights.map((_, i) => {
    const a = ref.straights[i]?.cost_time;
    const b = lap.straights[i]?.cost_time;
    return a == null || b == null ? null : Math.abs(b - a);
  });
  const i = worst(diffs);
  const where =
    i >= 0 && (diffs[i] ?? 0) >= ENERGY_LEVEL ? `, most into T${straights[i].corner}` : '';
  return `${name} loses ≈${Math.abs(diff).toFixed(2)} s ${diff > 0 ? 'more' : 'less'} than ${refName} to clipping${where}.`;
}

/** Downshifts at full throttle on a lap's straights, or null if there are none. */
export function explainDownshifts(
  name: string,
  lap: EnergyLap,
  straights: EnergyStraight[]
): string | null {
  const where = lap.straights.flatMap((s, i) =>
    s && s.downshifts.length > 0 ? [{ s, corner: straights[i].corner }] : []
  );
  if (where.length === 0) return null;
  const [first] = where;
  const shift = first.s.downshifts[0];
  const before = Math.max(Math.round(first.s.end - shift.at), 0);
  const more =
    where.length > 1
      ? ` and into ${where
          .slice(1)
          .map((w) => `T${w.corner}`)
          .join(', ')}`
      : '';
  return (
    `${name} downshifts at full throttle into T${first.corner} (to ${shift.gear}th at ` +
    `${shift.speed.toFixed(0)} km/h, ${before} m before the ${first.s.coast > 0 ? 'lift' : 'brake'})` +
    `${more}: keeping the engine above 10,500 rpm while harvesting.`
  );
}
