import { useSyncExternalStore } from 'react';
import type { StraightMode, StraightModeZone } from '@/api/client';
import { clock } from '@/store/clock';

/** A straight-mode zone as it applies at a moment: with the low-grip start in low grip. */
export type ActiveZone = {
  label: string;
  start: number;
  end: number;
  /** Where it starts, as the FIA writes it. */
  activation: string;
  endSource: StraightModeZone['end_source'];
};

const END_SOURCE: Record<StraightModeZone['end_source'], string> = {
  braking: 'where most laps brake',
  next_zone: 'where the next zone starts',
  drawing: 'as drawn on the FIA map',
  next_corner: 'estimated before the next corner',
};

/** Race control declared low-grip conditions at `t` (session time). */
export function lowGripAt(data: StraightMode | undefined, t: number | null | undefined): boolean {
  if (!data || t == null) return false;
  return data.low_grip.some((p) => t >= p.start && (p.end == null || t < p.end));
}

/** The zones in normal grip, or in low grip (later starts; some zones none). */
export function activeZones(data: StraightMode | undefined, lowGrip: boolean): ActiveZone[] {
  if (!data) return [];
  return data.zones.flatMap((z) => {
    const start = lowGrip ? z.low_grip_start : z.start;
    if (start == null) return [];
    const activation = lowGrip ? (z.low_grip_activation ?? '') : z.activation;
    return [{ label: z.label, start, end: z.end, activation, endSource: z.end_source }];
  });
}

/** A zone as a line of text: 'A1: from 30m after T11 to where most laps brake'. */
export function describeZone(zone: ActiveZone, lowGrip: boolean): string {
  const grip = lowGrip ? ' (low grip)' : '';
  return `Straight mode ${zone.label}${grip}: from ${zone.activation}, to ${END_SOURCE[zone.endSource]}`;
}

/** Low grip at the session clock; re-renders only when that changes. */
export function useLowGripAtClock(data: StraightMode | undefined): boolean {
  return useSyncExternalStore(clock.subscribe, () => lowGripAt(data, clock.time()));
}
