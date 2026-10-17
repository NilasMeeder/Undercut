import { useMemo } from 'react';
import type { Lap } from '@/api/client';
import { useLaps, useSessionDetail } from '@/api/queries';
import { DriverCell, PanelMessage } from '@/components/data/bits';
import { formatGap, formatLapTime, formatSector } from '@/lib/format';
import { rowStyle, td, th } from '@/lib/table';
import { bestLaps, computeBests, SECTORS, type Bests } from '@/lib/timing';
import { cn } from '@/lib/utils';
import { useLapSelection } from '@/store/groups';
import type { WidgetProps } from '../types';
import type { BestsConfig } from './widget';

type Row = {
  lap: Lap;
  sectors: (number | null)[];
  ideal: number | null;
};

function sum(values: (number | null)[]): number | null {
  return values.every((v) => v != null) ? values.reduce<number>((a, v) => a + v!, 0) : null;
}

function buildRows(laps: Lap[], bests: Bests, order: BestsConfig['order']): Row[] {
  const rows = bestLaps(laps).map((lap) => {
    const mine = bests.personal.get(lap.driver);
    const sectors = SECTORS.map((s) => mine?.[s] ?? null);
    return { lap, sectors, ideal: sum(sectors) };
  });
  if (order === 'ideal') rows.sort((a, b) => (a.ideal ?? Infinity) - (b.ideal ?? Infinity));
  return rows;
}

export function BestsWidget({ group, config }: WidgetProps<BestsConfig>) {
  const laps = useLaps();
  const detail = useSessionDetail();
  const { isSelected, toggle } = useLapSelection(group);

  const bests = useMemo(() => computeBests(laps.data ?? []), [laps.data]);
  const rows = useMemo(
    () => buildRows(laps.data ?? [], bests, config.order),
    [laps.data, bests, config.order]
  );

  if (laps.error) return <PanelMessage>{laps.error.message}</PanelMessage>;
  if (!laps.data || !detail.data) return <PanelMessage>Loading laps…</PanelMessage>;
  if (rows.length === 0) return <PanelMessage>No timed laps in this session.</PanelMessage>;

  const overall = SECTORS.map((s) => bests.overall[s]);
  const pole = bests.overall.lap_time;
  const sessionIdeal = sum(overall);
  const bestIdeal = Math.min(...rows.map((r) => r.ideal ?? Infinity));
  const owner = (s: number) =>
    rows.find((r) => r.sectors[s] != null && r.sectors[s] === overall[s])?.lap.driver;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 border-b border-line px-1.5 py-0.5 text-[11px]">
        <span className="text-[10px] font-medium uppercase text-faint">Session ideal</span>
        <span className="font-semibold text-best">{formatLapTime(sessionIdeal)}</span>
        {SECTORS.map((_, s) => (
          <span key={s} className="text-dim">
            S{s + 1} <span className="text-text">{owner(s)}</span> {formatSector(overall[s])}
          </span>
        ))}
        {pole != null && sessionIdeal != null ? (
          <span className="ml-auto text-faint" title="Pole lap minus the session ideal">
            pole {formatGap(pole - sessionIdeal)}
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full whitespace-nowrap text-[11px]">
          <thead>
            <tr>
              <th className={cn(th, 'text-right')}>P</th>
              <th className={cn(th, 'text-left')}>Drv</th>
              <th className={cn(th, 'text-right')}>Best</th>
              <th className={cn(th, 'text-right')}>Gap</th>
              <th className={cn(th, 'text-right')}>%</th>
              <th className={cn(th, 'text-right')}>S1</th>
              <th className={cn(th, 'text-right')}>S2</th>
              <th className={cn(th, 'text-right')}>S3</th>
              <th className={cn(th, 'text-right')}>Ideal</th>
              <th className={cn(th, 'text-right')} title="Best lap minus ideal lap">
                Δ ideal
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ lap, sectors, ideal }, i) => {
              const selected = isSelected(lap);
              const gap = pole != null && lap.lap_time != null ? lap.lap_time - pole : null;
              return (
                <tr
                  key={lap.driver}
                  onClick={() => toggle(lap)}
                  style={rowStyle(selected, group)}
                  className={cn('cursor-pointer hover:bg-raised', selected && 'bg-raised')}
                >
                  <td className={cn(td, 'text-faint')}>{i + 1}</td>
                  <DriverCell code={lap.driver} drivers={detail.data.drivers} />
                  <td className={cn(td, gap === 0 && 'text-best')}>
                    {formatLapTime(lap.lap_time)}
                  </td>
                  <td className={cn(td, 'text-dim')}>{gap ? formatGap(gap) : ''}</td>
                  <td className={cn(td, 'text-faint')}>
                    {gap && pole ? `${((gap / pole) * 100).toFixed(2)}` : ''}
                  </td>
                  {sectors.map((value, s) => {
                    const best = value != null && value === overall[s];
                    return (
                      <td key={s} className={cn(td, best ? 'text-best' : 'text-text')}>
                        {config.sectors === 'gap' && value != null && overall[s] != null
                          ? best
                            ? formatSector(value)
                            : formatGap(value - overall[s]!)
                          : formatSector(value)}
                      </td>
                    );
                  })}
                  <td className={cn(td, ideal === bestIdeal ? 'text-best' : 'text-text')}>
                    {formatLapTime(ideal)}
                  </td>
                  <td className={cn(td, 'text-dim')}>
                    {ideal != null && lap.lap_time != null ? formatGap(lap.lap_time - ideal) : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
