import { useMemo } from 'react';
import type uPlot from 'uplot';
import type { DriverInfo, LongRun } from '@/api/client';
import { useLaps, useLongRuns } from '@/api/queries';
import { LapChart, type LapSeries } from '@/components/chart/LapChart';
import { DriverCell, PanelMessage, TyreBadge } from '@/components/data/bits';
import { COLORS, DASHES } from '@/lib/colors';
import { formatGap, formatLapTime } from '@/lib/format';
import { formatDeg } from '@/lib/strategy';
import { rowStyle, td, th } from '@/lib/table';
import { bestLaps } from '@/lib/timing';
import { cn } from '@/lib/utils';
import { useLapSelection } from '@/store/groups';
import { useSelection } from '@/store/selection';
import type { WidgetProps } from '../types';
import { useGroupDrivers, useStrategyClock } from '../useStrategy';
import type { LongRunsConfig } from './widget';

const yFormat = (v: number) => {
  const m = Math.floor(v / 60);
  return `${m}:${(v - m * 60).toFixed(2).padStart(5, '0')}`;
};

/** Seconds above the quickest lap of a compound that the little lines still show. */
const SPARK_RANGE = 3;

const runKey = (r: LongRun) => `${r.session}-${r.driver}-${r.start_lap}`;

export function LongRunsWidget({ group, config }: WidgetProps<LongRunsConfig>) {
  const { drivers, until, error } = useStrategyClock();
  const runs = useLongRuns(until, config.fuel, config.sessions === 'weekend');
  const session = useSelection((s) => s.session);
  const laps = useLaps();
  const best = useMemo(() => bestLaps(laps.data ?? []), [laps.data]);
  const selected = useGroupDrivers(group);
  const { isSelected, toggle } = useLapSelection(group);
  const list = runs.data?.runs;
  const burn = config.fuel > 0 ? (runs.data?.fuel_per_lap ?? 0) : 0;

  const chart = useMemo(() => {
    if (!list) return null;
    const shown = list.filter((r) => selected.includes(r.driver));
    if (shown.length === 0) return null;
    const length = Math.max(...shown.map((r) => r.times.length));
    const xs = Array.from({ length }, (_, i) => i + 1);
    const seen = new Map<string, number>();
    const series: LapSeries[] = [];
    const columns: (number | null)[][] = [];
    for (const r of shown) {
      const color = drivers?.find((d) => d.code === r.driver)?.color ?? COLORS.textDim;
      const count = seen.get(color) ?? 0;
      seen.set(color, count + 1);
      series.push({
        label: `${r.driver} ${r.compound?.[0] ?? '?'}${r.session === session ? '' : ` ${r.session}`}`,
        color,
        dash: DASHES[count % DASHES.length],
        strong: true,
      });
      // As if every lap carried the fuel of the run's first lap.
      columns.push(xs.map((_, k) => (r.times[k] == null ? null : r.times[k]! + burn * k)));
    }
    const values = columns.flat().filter((v) => v != null);
    const low = Math.min(...values);
    const yRange: [number, number] = [
      Math.floor(low * 4) / 4 - 0.25,
      Math.ceil(Math.min(Math.max(...values), low + SPARK_RANGE) * 4) / 4,
    ];
    return {
      data: [xs, ...columns] as uPlot.AlignedData,
      series,
      xRange: [1, Math.max(2, length)] as [number, number],
      yRange,
    };
  }, [list, selected, drivers, burn, session]);

  if (error ?? runs.error) return <PanelMessage>{(error ?? runs.error)!.message}</PanelMessage>;
  if (!list || !drivers) return <PanelMessage>Loading long runs…</PanelMessage>;
  if (list.length === 0)
    return (
      <PanelMessage>
        {session?.startsWith('FP') || config.sessions === 'weekend'
          ? 'No long runs yet (5 laps at pace on one set).'
          : 'Long runs are for practice: set Sessions to the weekend to see those before this one.'}
      </PanelMessage>
    );

  const sessions = new Set(list.map((r) => r.session));
  const click = (r: LongRun) => {
    if (r.session === session) toggle({ driver: r.driver, lap: r.typical });
    else {
      const lap = best.find((l) => l.driver === r.driver);
      if (lap) toggle(lap);
    }
  };
  const isPicked = (r: LongRun) =>
    r.session === session
      ? isSelected({ driver: r.driver, lap: r.typical })
      : selected.includes(r.driver);
  const floor = new Map<string | null, number>();
  for (const r of list) floor.set(r.compound, Math.min(floor.get(r.compound) ?? Infinity, r.best));

  return (
    <div className="flex h-full flex-col">
      <div className={cn('overflow-auto', config.chart && chart ? 'max-h-[55%]' : 'flex-1')}>
        <table className="w-full whitespace-nowrap text-[11px] tabular-nums">
          <thead>
            <tr>
              <th className={cn(th, 'text-left')}>Drv</th>
              {sessions.size > 1 ? <th className={cn(th, 'text-left')}>Ses</th> : null}
              <th className={cn(th, 'text-left')} title="Compound; +n = laps already on the set">
                Tyre
              </th>
              <th className={cn(th, 'text-right')} title="Laps at pace (laps of the session)">
                Laps
              </th>
              <th className={cn(th, 'text-right')}>Median</th>
              <th className={cn(th, 'text-right')} title="To the quickest median on this compound">
                Gap
              </th>
              <th className={cn(th, 'text-right')}>Best</th>
              <th
                className={cn(th, 'text-right')}
                title={
                  config.fuel > 0
                    ? 'Seconds per lap slower, with the fuel burn put back (assumed)'
                    : 'Seconds per lap slower (raw: fuel burn and tyres together)'
                }
              >
                Deg
              </th>
              <th className={cn(th, 'text-left')} title="Lap times of the run">
                Run
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => {
              const picked = isPicked(r);
              const first = i === 0 || list[i - 1].compound !== r.compound;
              return (
                <tr
                  key={runKey(r)}
                  onClick={() => click(r)}
                  style={rowStyle(picked, group)}
                  title={`${r.driver} ${r.session} laps ${r.start_lap}–${r.end_lap}, typical L${r.typical}`}
                  className={cn(
                    'cursor-pointer hover:bg-raised',
                    picked && 'bg-raised',
                    first && i > 0 && 'border-t border-line'
                  )}
                >
                  <DriverCell code={r.driver} drivers={drivers} />
                  {sessions.size > 1 ? (
                    <td
                      className={cn(
                        'px-1.5 py-[1px] text-left',
                        r.session === session ? 'text-dim' : 'text-faint'
                      )}
                    >
                      {r.session}
                    </td>
                  ) : null}
                  <td className="px-1.5 py-[1px] text-left">
                    <span className="inline-flex items-center gap-1">
                      <TyreBadge compound={r.compound} />
                      <span className="text-[10px] text-faint">
                        {r.used == null ? '' : r.used === 0 ? 'NEW' : `+${r.used}`}
                      </span>
                    </span>
                  </td>
                  <td className={cn(td, 'text-dim')}>
                    {r.laps}
                    {r.open ? <span title="Still on this set at the clock">•</span> : ''}
                  </td>
                  <td className={td}>{formatLapTime(r.median)}</td>
                  <td className={cn(td, r.gap === 0 ? 'text-text' : 'text-dim')}>
                    {r.gap === 0 ? '' : formatGap(r.gap)}
                  </td>
                  <td className={cn(td, 'text-dim')}>{formatLapTime(r.best)}</td>
                  <td className={td}>
                    {config.fuel > 0
                      ? r.deg != null
                        ? formatDeg(r.deg)
                        : ''
                      : r.slope != null
                        ? formatDeg(r.slope)
                        : ''}
                  </td>
                  <td className="px-1.5 py-[1px]">
                    <span className="inline-flex items-center gap-1">
                      <Spark run={r} low={floor.get(r.compound)!} burn={burn} drivers={drivers} />
                      {r.step != null && r.step_lap != null ? (
                        <span
                          className="text-[10px] text-dim"
                          title={`Pace ${r.step < 0 ? 'quicker' : 'slower'} by ${Math.abs(r.step).toFixed(2)} s a lap from lap ${r.step_lap}`}
                        >
                          {r.step >= 0 ? '+' : '−'}
                          {Math.abs(r.step).toFixed(1)} L{r.step_lap}
                        </span>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {config.chart ? (
        chart ? (
          <div className="flex min-h-0 flex-1 flex-col border-t border-line">
            <div className="shrink-0 px-1.5 pt-0.5 text-[10px] uppercase text-faint">
              {burn > 0 ? 'Lap time with the fuel of the first lap' : 'Lap time'} by lap of the run
            </div>
            <LapChart
              group={group}
              data={chart.data}
              series={chart.series}
              xRange={chart.xRange}
              yRange={chart.yRange}
              yFormat={yFormat}
              xLabel="LAP OF RUN"
              format={formatLapTime}
            />
          </div>
        ) : (
          <div className="shrink-0 border-t border-line px-1.5 py-1 text-[10px] text-faint">
            Select drivers in this link group to see their runs lap by lap.
          </div>
        )
      ) : null}
    </div>
  );
}

const SPARK_W = 64;
const SPARK_H = 12;

/** The run's lap times as a little line, on one scale per compound (its quickest lap at the
 * bottom, SPARK_RANGE s above it at the top), so the shapes and levels compare down the table. */
function Spark({
  run,
  low,
  burn,
  drivers,
}: {
  run: LongRun;
  low: number;
  burn: number;
  drivers: DriverInfo[];
}) {
  const n = run.times.length;
  const x = (k: number) => (n > 1 ? (k / (n - 1)) * (SPARK_W - 2) + 1 : SPARK_W / 2);
  const y = (v: number) =>
    SPARK_H - 1 - Math.min(1, Math.max(0, (v - low) / SPARK_RANGE)) * (SPARK_H - 2);
  let d = '';
  let pen = false;
  run.times.forEach((v, k) => {
    if (v == null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${x(k).toFixed(1)},${y(v + burn * k).toFixed(1)}`;
    pen = true;
  });
  const color = drivers.find((dr) => dr.code === run.driver)?.color ?? COLORS.textDim;
  // Where the pace stepped: between the last lap before and the first at the new pace.
  const tick = run.step_lap != null ? x(run.step_lap - run.start_lap - 0.5) : null;
  return (
    <svg width={SPARK_W} height={SPARK_H} className="block">
      {tick != null ? (
        <line x1={tick} x2={tick} y1={0} y2={SPARK_H} stroke={COLORS.textDim} strokeWidth={1} />
      ) : null}
      <path d={d} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  );
}
