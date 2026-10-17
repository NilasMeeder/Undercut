import { useCallback, useMemo } from 'react';
import type { DriverInfo, RaceHistory } from '@/api/client';
import { useRaceHistory, useSessionDetail, useTimeline } from '@/api/queries';
import { COLORS, DASHES } from '@/lib/colors';
import { completedAt, latestLap, strategyCutoff } from '@/lib/strategy';
import { useClockTime } from '@/store/clock';
import { useGroupLaps, useGroups, type GroupId } from '@/store/groups';

/**
 * What every strategy widget shares: the race lap by lap, the clock time (a few renders a second)
 * and the cutoff for the fits and the pit window (once a lap). `until` is undefined while loading.
 */
export function useStrategyClock() {
  const history = useRaceHistory();
  const timeline = useTimeline();
  const detail = useSessionDetail();
  const t = useClockTime(250);
  const ready = history.data && timeline.data;
  const until = ready ? strategyCutoff(history.data!, timeline.data!, t) : undefined;
  return {
    history: history.data,
    timeline: timeline.data,
    drivers: detail.data?.drivers,
    t,
    until,
    error: history.error ?? timeline.error,
  };
}

/** The drivers of a link group's selected laps, in the order they were selected. */
export function useGroupDrivers(group: GroupId): string[] {
  const laps = useGroupLaps(group);
  return useMemo(() => [...new Set(laps.map((l) => l.driver))], [laps]);
}

/**
 * Click a driver in a strategy widget: deselect all his laps in the group, or select the lap he
 * had just completed at the clock (so the analysis widgets show it).
 */
export function useToggleDriver(group: GroupId) {
  const laps = useGroupLaps(group);
  const setLaps = useGroups((s) => s.setLaps);
  const toggleLap = useGroups((s) => s.toggleLap);
  const history = useRaceHistory();
  return useCallback(
    (driver: string, t: number) => {
      if (laps.some((l) => l.driver === driver)) {
        setLaps(
          group,
          laps.filter((l) => l.driver !== driver)
        );
        return;
      }
      const race = history.data?.drivers.find((d) => d.driver === driver);
      toggleLap(group, { driver, lap: race ? latestLap(race, t) : 1 });
    },
    [group, laps, setLaps, toggleLap, history.data]
  );
}

/** Team colour per driver; the second driver of a team dashed, so identity is never colour alone. */
export function driverStyles(
  codes: string[],
  drivers: DriverInfo[] | undefined
): Map<string, { color: string; dash: number[] | undefined }> {
  const seen = new Map<string, number>();
  return new Map(
    codes.map((code) => {
      const color = drivers?.find((d) => d.code === code)?.color ?? COLORS.textDim;
      const count = seen.get(color) ?? 0;
      seen.set(color, count + 1);
      return [code, { color, dash: DASHES[count % DASHES.length] }];
    })
  );
}

/** Laps completed per driver at t, as one string: it changes at every line crossing only. */
export function crossingsKey(history: RaceHistory | undefined, t: number): string {
  return history ? history.drivers.map((d) => completedAt(d, t)).join(',') : '';
}
