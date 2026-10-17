import { useMemo } from 'react';
import { useCircuit, useTimeline } from '@/api/queries';
import { useClockTime } from '@/store/clock';

export type ActiveSectorFlag = {
  sector: number;
  double: boolean;
  /** Lap-distance ranges (m): two for the sector over the line. */
  ranges: [number, number][];
};

/** Yellow flags in marshal sectors at the session clock (re-renders a few times a second). */
export function useSectorFlags(lapLength?: number): ActiveSectorFlag[] {
  const timeline = useTimeline();
  const circuit = useCircuit();
  const t = useClockTime(250);
  const length = lapLength ?? circuit.data?.lap_length ?? 0;
  const active = (timeline.data?.sector_flags ?? []).filter((f) => f.start <= t && t < f.end);
  const key = active.map((f) => `${f.sector}${f.flag}`).join();
  return useMemo(() => {
    const sectors = circuit.data?.marshal_sectors ?? [];
    return active.flatMap((f) => {
      const s = sectors.find((m) => m.number === f.sector);
      if (!s) return [];
      const ranges: [number, number][] =
        s.end >= s.start
          ? [[s.start, s.end]]
          : [
              [s.start, length],
              [0, s.end],
            ];
      return [{ sector: f.sector, double: f.flag === 'double_yellow', ranges }];
    });
    // `key` stands for `active`, which is a new array on every clock re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, circuit.data, length]);
}
