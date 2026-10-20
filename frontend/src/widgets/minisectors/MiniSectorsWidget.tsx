import { useMemo } from 'react';
import type { Circuit } from '@/api/client';
import { useCircuit } from '@/api/queries';
import { NoLapsMessage, PanelMessage } from '@/components/data/bits';
import { formatGap, formatLapTime, formatSector } from '@/lib/format';
import { td, th } from '@/lib/table';
import { cn } from '@/lib/utils';
import { cursorBus, useZoom } from '@/store/cursor';
import type { WidgetProps } from '../types';
import { useGroupComparison } from '../useGroupComparison';
import { FieldMiniSectors } from './FieldMiniSectors';
import type { MiniSectorsConfig } from './widget';

/** The corners whose apex lies in [start, end), scaled from the circuit's lap to this one. */
function cornersIn(corners: Circuit['corners'], scale: number, start: number, end: number): string {
  const inside = corners.filter((c) => c.distance * scale >= start && c.distance * scale < end);
  if (inside.length === 0) return '';
  const first = inside[0].label;
  const last = inside[inside.length - 1].label;
  return inside.length === 1 ? `T${first}` : `T${first}–${last}`;
}

export function MiniSectorsWidget({ group, config }: WidgetProps<MiniSectorsConfig>) {
  return config.view === 'field' ? (
    <FieldMiniSectors config={config} />
  ) : (
    <CompareMiniSectors group={group} config={config} />
  );
}

/** The group's compared laps per mini-sector, as a table. */
function CompareMiniSectors({
  group,
  config,
}: Pick<WidgetProps<MiniSectorsConfig>, 'group' | 'config'>) {
  const { laps, data, styles, error, isFetching } = useGroupComparison(group, {
    miniSectors: config.count,
  });
  const circuit = useCircuit().data;
  const zoom = useZoom(group);

  const table = useMemo(() => {
    if (!data) return null;
    const { boundaries, times, fastest } = data.mini_sectors;
    const length = boundaries[boundaries.length - 1] ?? 0;
    const scale = circuit && circuit.lap_length > 0 ? length / circuit.lap_length : 1;
    const rows = boundaries.slice(0, -1).map((start, i) => {
      const end = boundaries[i + 1];
      const best = Math.min(...times.map((t) => t[i]));
      return {
        start,
        end,
        where: circuit ? cornersIn(circuit.corners, scale, start, end) : '',
        best,
        fastest: fastest[i],
        times: times.map((t) => t[i]),
      };
    });
    const ideal = rows.reduce((sum, r) => sum + r.best, 0);
    const totals = times.map((t) => t.reduce((sum, v) => sum + v, 0));
    const wins = times.map((_, n) => rows.filter((r) => r.fastest === n).length);
    return { rows, ideal, totals, wins };
  }, [data, circuit]);

  if (laps.length === 0) return <NoLapsMessage group={group} />;
  if (error) return <PanelMessage>{error.message}</PanelMessage>;
  if (!data || !table) return <PanelMessage>Loading laps…</PanelMessage>;

  const isZoomed = (start: number, end: number) =>
    zoom != null && zoom[0] === start && zoom[1] === end;

  return (
    <div className={cn('flex h-full flex-col', isFetching && 'opacity-60')}>
      <div className="flex shrink-0 items-baseline gap-3 border-b border-line px-1.5 py-0.5 text-[11px]">
        <span className="text-[10px] font-medium uppercase text-faint">Ideal</span>
        <span className="font-semibold text-best">{formatLapTime(table.ideal)}</span>
        {data.laps.length > 1 ? (
          <span className="text-faint">the quickest of these laps in every mini-sector</span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full whitespace-nowrap text-[11px] tabular-nums">
          <thead>
            <tr>
              <th className={cn(th, 'text-right')}>#</th>
              <th className={cn(th, 'text-left')}>Where</th>
              <th className={cn(th, 'text-right')}>From</th>
              {data.laps.map((lap, n) => (
                <th key={`${lap.driver}:${lap.lap}`} className={cn(th, 'text-right')}>
                  <span
                    className="mr-1 inline-block h-2 w-[3px] align-[-1px]"
                    style={{ background: styles[n]?.color }}
                  />
                  {lap.driver} L{lap.lap}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => {
              const zoomed = isZoomed(row.start, row.end);
              return (
                <tr
                  key={i}
                  onMouseEnter={() => cursorBus.setCursor(group, (row.start + row.end) / 2)}
                  onClick={() => cursorBus.setZoom(group, zoomed ? null : [row.start, row.end])}
                  className={cn('cursor-pointer hover:bg-raised', zoomed && 'bg-raised')}
                >
                  <td className={cn(td, 'text-faint')}>{i + 1}</td>
                  <td className="px-1.5 py-[1px] text-left text-dim">{row.where}</td>
                  <td className={cn(td, 'text-faint')}>{Math.round(row.start)}</td>
                  {row.times.map((time, n) => {
                    const quickest = n === row.fastest;
                    return (
                      <td
                        key={n}
                        className={cn(
                          td,
                          quickest && data.laps.length > 1 ? 'text-best' : 'text-dim'
                        )}
                      >
                        {config.values === 'time' || quickest
                          ? formatSector(time)
                          : formatGap(time - row.best)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-line">
              <td className={cn(td, 'text-[10px] uppercase text-faint')} colSpan={3}>
                Lap
              </td>
              {table.totals.map((total, n) => (
                <td key={n} className={cn(td, 'font-semibold')}>
                  {formatLapTime(total)}
                </td>
              ))}
            </tr>
            {data.laps.length > 1 ? (
              <>
                <tr>
                  <td className={cn(td, 'text-[10px] uppercase text-faint')} colSpan={3}>
                    Lost
                  </td>
                  {table.totals.map((total, n) => (
                    <td key={n} className={cn(td, 'text-dim')}>
                      {formatGap(total - table.ideal)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className={cn(td, 'text-[10px] uppercase text-faint')} colSpan={3}>
                    Quickest in
                  </td>
                  {table.wins.map((wins, n) => (
                    <td key={n} className={cn(td, 'text-dim')}>
                      {wins}/{table.rows.length}
                    </td>
                  ))}
                </tr>
              </>
            ) : null}
          </tfoot>
        </table>
      </div>
    </div>
  );
}
