import { useMemo } from 'react';
import type { Comparison } from '@/api/client';
import { useLaps, useStraightMode } from '@/api/queries';
import type { ChartLine, ChartZone } from '@/components/chart/UPlotChart';
import { COLORS } from '@/lib/colors';
import { activeZones, lowGripAt } from '@/lib/straightMode';
import { useSelection } from '@/store/selection';

const NONE: ChartZone[] = [];
const NO_LINES: ChartLine[] = [];

/** Straight-mode zones (2026) for the charts of a comparison: on the first lap's scale, and in
 * low grip when race control had declared it as that lap started. */
export function useStraightModeZones(comparison: Comparison | undefined, enabled: boolean) {
  const straightMode = useStraightMode(enabled).data;
  const laps = useLaps().data;
  const first = comparison?.laps[0];
  const start = useMemo(
    () =>
      first
        ? laps?.find((l) => l.driver === first.driver && l.lap === first.lap)?.start_time
        : undefined,
    [laps, first]
  );
  return useMemo(() => {
    if (!enabled || !straightMode || !comparison || straightMode.length <= 0) return NONE;
    const length = comparison.distance.at(-1) ?? straightMode.length;
    const scale = length / straightMode.length;
    // A zone from before the line (start below zero) is also the end of this lap.
    return activeZones(straightMode, lowGripAt(straightMode, start)).flatMap((z) => {
      const zone = { label: z.label, start: z.start * scale, end: z.end * scale };
      return zone.start < 0
        ? [
            { ...zone, start: 0 },
            { ...zone, start: zone.start + length, end: length },
          ]
        : [zone];
    });
  }, [enabled, straightMode, comparison, start]);
}

/** The FIA's overtake detection and activation lines (2026) for the charts of a comparison, on
 * its scale: only in races and sprints, the only sessions with overtake mode. Detection comes
 * first along the lap, so its label goes to the left and activation's to the right. */
export function useOvertakeLines(comparison: Comparison | undefined, enabled: boolean) {
  const session = useSelection((s) => s.session);
  const race = session === 'R' || session === 'S';
  const straightMode = useStraightMode(enabled && race).data;
  return useMemo(() => {
    const points = straightMode?.overtake;
    if (!enabled || !race || !points || !comparison || straightMode.length <= 0) return NO_LINES;
    const length = comparison.distance.at(-1) ?? straightMode.length;
    const at = (d: number) => ((((d * length) / straightMode.length) % length) + length) % length;
    return [
      { at: at(points.detection), label: 'OT D', color: COLORS.ers, side: 'left' },
      { at: at(points.activation), label: 'OT A', color: COLORS.ers, side: 'right' },
    ] satisfies ChartLine[];
  }, [enabled, race, straightMode, comparison]);
}
