import { useMemo } from 'react';
import {
  useCircuit,
  useLaps,
  useReplayPositions,
  useSectors,
  useSessionDetail,
  useTimingState,
} from '@/api/queries';
import { PanelMessage } from '@/components/data/bits';
import { formatSector } from '@/lib/format';
import { fieldSegments, layoutFor, type Segment, type SegmentColour } from '@/lib/miniSectors';
import { carAt } from '@/lib/replay';
import { cn } from '@/lib/utils';
import { useClockTime } from '@/store/clock';
import { useGroups } from '@/store/groups';
import type { MiniSectorsConfig } from './widget';

const BG: Record<SegmentColour, string> = { best: 'bg-best', pb: 'bg-pb', slow: 'bg-slow' };
const NAME: Record<SegmentColour, string> = {
  best: 'quickest of all so far',
  pb: 'own quickest so far',
  slow: 'not an improvement',
};

type Row = {
  driver: string;
  position: number | null;
  lap: number | null;
  cells: (Segment | null)[];
  /** In the garage or off the track: the last lap it drove, shown faint. */
  parked: boolean;
};

/**
 * Every driver with a block per mini-sector, as on the official timing screens: the lap on the
 * clock filling up as it is driven (or each driver's best lap), purple / green / yellow.
 */
export function FieldMiniSectors({ config }: { config: MiniSectorsConfig }) {
  const { track, status, error } = useReplayPositions();
  const sectors = useSectors().data;
  const circuit = useCircuit().data;
  const laps = useLaps().data;
  const timing = useTimingState().data;
  const drivers = useSessionDetail().data?.drivers;
  const selected = useGroups((s) => s.laps);
  const t = useClockTime(250);

  const layout = useMemo(
    () =>
      sectors && circuit && circuit.lap_length > 0
        ? layoutFor(sectors.boundaries, circuit.lap_length)
        : null,
    [sectors, circuit]
  );
  // Live the track grows in place: work it out again every ~2 s of new points.
  const growth = track ? Math.floor(track.count / 8) : 0;
  const field = useMemo(
    () => (track && layout ? fieldSegments(track, layout) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- growth stands for the track's count
    [track, layout, growth]
  );

  const inGroups = useMemo(
    () => new Set(Object.values(selected).flatMap((refs) => refs.map((r) => r.driver))),
    [selected]
  );

  const rows = useMemo((): Row[] => {
    if (!track || !field) return [];
    const order = timing?.rows.map((r) => r.driver) ?? [];
    const codes = [...order, ...track.cars.map((c) => c.driver).filter((d) => !order.includes(d))];
    const position = new Map(timing?.rows.map((r) => [r.driver, r.position]) ?? []);
    const best = new Map<string, number>();
    if (config.lap === 'best') {
      const fastest = new Map<string, number>();
      for (const lap of laps ?? []) {
        if (lap.lap_time == null || lap.deleted || lap.end_time == null || lap.end_time > t)
          continue;
        if (lap.lap_time < (fastest.get(lap.driver) ?? Infinity)) {
          fastest.set(lap.driver, lap.lap_time);
          best.set(lap.driver, lap.lap);
        }
      }
    }
    return codes.map((driver) => {
      const own = field.get(driver);
      const done = (lap: number | null) =>
        (lap != null ? own?.get(lap) : undefined)?.map((s) => (s && s.end <= t ? s : null)) ?? [];
      if (config.lap === 'best') {
        const lap = best.get(driver) ?? null;
        return {
          driver,
          position: position.get(driver) ?? null,
          lap,
          cells: done(lap),
          parked: false,
        };
      }
      const index = track.cars.findIndex((c) => c.driver === driver);
      const at = index < 0 ? null : carAt(track, index, t);
      let lap = at && !Number.isNaN(at.progress) ? Math.floor(at.progress) + 1 : null;
      const parked = lap == null;
      if (lap == null && own) {
        // The last lap with a mini-sector done by now.
        for (const [n, cells] of own)
          if (cells.some((s) => s && s.end <= t) && n > (lap ?? 0)) lap = n;
      }
      return { driver, position: position.get(driver) ?? null, lap, cells: done(lap), parked };
    });
  }, [track, field, timing, laps, t, config.lap]);

  if (error) return <PanelMessage>{error.message}</PanelMessage>;
  if (!track)
    return (
      <PanelMessage>
        {`${status?.phase ?? 'Preparing positions'}… ${Math.round((status?.progress ?? 0) * 100)}%`}
      </PanelMessage>
    );
  if (!layout || !field) return <PanelMessage>Loading…</PanelMessage>;

  const n = layout.starts.length;
  // Where a sector starts, for the wider gap and the S1/S2/S3 heading.
  const sectorStart = new Set(
    layout.perSector
      .slice(0, -1)
      .map((_, s) => layout.perSector.slice(0, s + 1).reduce((a, b) => a + b, 0))
  );
  const columns = `22px 44px 30px repeat(${n}, minmax(3px, 1fr))`;
  const gapLeft = (k: number) => (sectorStart.has(k) ? 'ml-1' : '');
  return (
    <div className="flex h-full flex-col overflow-auto px-1.5 py-1 text-[11px] tabular-nums">
      <div
        className="mb-0.5 grid items-end gap-x-px text-[10px] text-faint"
        style={{ gridTemplateColumns: columns }}
      >
        <span>P</span>
        <span>DRV</span>
        <span>LAP</span>
        {layout.perSector.map((count, s) => (
          <span
            key={s}
            className={cn('font-semibold', s > 0 && 'ml-1')}
            style={{ gridColumn: `span ${count}` }}
          >
            S{s + 1}
          </span>
        ))}
      </div>
      {rows.map((row) => {
        const color = drivers?.find((d) => d.code === row.driver)?.color;
        return (
          <div
            key={row.driver}
            className={cn(
              'grid items-center gap-x-px py-[1.5px]',
              inGroups.has(row.driver) && 'bg-line',
              row.parked && 'opacity-40'
            )}
            style={{ gridTemplateColumns: columns }}
          >
            <span className="text-faint">{row.position ?? ''}</span>
            <span className="font-semibold">
              <span
                className="mr-1 inline-block h-2.5 w-[3px] align-[-1px]"
                style={{ background: color }}
              />
              {row.driver}
            </span>
            <span className="text-faint">{row.lap ?? ''}</span>
            {Array.from({ length: n }, (_, k) => {
              const s = row.cells[k] ?? null;
              return (
                <span
                  key={k}
                  title={
                    s
                      ? `Mini-sector ${k + 1}: ${formatSector(s.time)}, ${NAME[s.colour]}`
                      : undefined
                  }
                  className={cn('h-3', gapLeft(k), s ? BG[s.colour] : 'bg-line-strong')}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
