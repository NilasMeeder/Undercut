import { useMemo } from 'react';
import type uPlot from 'uplot';
import type { CompoundPace, StintPace } from '@/api/client';
import { useDegradation } from '@/api/queries';
import { LapChart, type LapSeries } from '@/components/chart/LapChart';
import { DriverCell, PanelMessage, TyreBadge } from '@/components/data/bits';
import { DASHES } from '@/lib/colors';
import { formatLapTime } from '@/lib/format';
import { completedAt, formatDeg, lapAxis, statusBands } from '@/lib/strategy';
import { td, th } from '@/lib/table';
import { cn } from '@/lib/utils';
import type { WidgetProps } from '../types';
import { crossingsKey, driverStyles, useGroupDrivers, useStrategyClock } from '../useStrategy';
import type { PaceConfig } from './widget';

const yFormat = (v: number) => {
  const m = Math.floor(v / 60);
  return `${m}:${(v - m * 60).toFixed(2).padStart(5, '0')}`;
};

export function PaceWidget({ group, config }: WidgetProps<PaceConfig>) {
  const { history, timeline, drivers, t, until, error } = useStrategyClock();
  const deg = useDegradation(until, config.fuel);
  const selected = useGroupDrivers(group);
  const crossings = crossingsKey(history, t);
  const byAge = config.x === 'age';

  const chart = useMemo(() => {
    if (!history || !deg.data) return null;
    const total = history.total_laps ?? Math.max(...history.drivers.map((d) => d.laps.at(-1) ?? 0));
    const fuel = deg.data.fuel_per_lap;
    const styles = driverStyles(
      history.drivers.map((d) => d.driver),
      drivers
    );
    const races = selected
      .map((code) => history.drivers.find((d) => d.driver === code))
      .filter((d) => d != null);
    const maxAge = Math.max(1, ...races.flatMap((d) => d.tyre_life.map((a) => a ?? 0)));
    const xs = Array.from({ length: byAge ? maxAge : total }, (_, i) => i + 1);
    const series: LapSeries[] = [];
    const columns: (number | null)[][] = [];
    const fitSeries: LapSeries[] = [];
    const fitColumns: (number | null)[][] = [];
    for (const d of races) {
      const style = styles.get(d.driver)!;
      const done = completedAt(d, t);
      d.stints.forEach((stint, k) => {
        const points: (number | null)[] = xs.map(() => null);
        const line: (number | null)[] = xs.map(() => null);
        const pace = deg.data.stints.find((s) => s.driver === d.driver && s.stint === stint.number);
        for (let i = 0; i < done; i++) {
          const lap = d.laps[i];
          const age = d.tyre_life[i];
          if (lap < stint.start_lap || lap > stint.end_lap || age == null) continue;
          const x = byAge ? age : lap;
          const time = d.lap_time[i];
          if (d.clean[i] && time != null) points[x - 1] = time - fuel * (total - lap);
          const fit = pace?.fit;
          if (fit && lap >= fit.laps[0] && lap <= fit.laps.at(-1)!)
            line[x - 1] = fit.base + fit.slope * age;
        }
        if (points.every((v) => v == null)) return;
        const letter = stint.compound?.[0] ?? '?';
        series.push({
          label: `${d.driver} ${letter}`,
          color: style.color,
          points: true,
          strong: true,
        });
        columns.push(points);
        if (config.fits && line.some((v) => v != null)) {
          fitSeries.push({
            label: `${d.driver} ${letter} fit`,
            color: style.color,
            dash: byAge ? DASHES[k % DASHES.length] : style.dash,
            quiet: true,
          });
          fitColumns.push(line);
        }
      });
    }
    const values = columns.flat().filter((v) => v != null);
    // Clean laps only, but a slow one (traffic) should not squash the rest: clip at +3 s.
    const low = Math.min(...values);
    const yRange: [number, number] | undefined = values.length
      ? [Math.floor(low * 4) / 4 - 0.25, Math.ceil(Math.min(Math.max(...values), low + 3) * 4) / 4]
      : undefined;
    return {
      data: [xs, ...fitColumns, ...columns] as uPlot.AlignedData,
      series: [...fitSeries, ...series],
      xRange: [1, xs.length] as [number, number],
      yRange,
    };
    // `crossings` stands for t: the data only changes when a car crosses the line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, deg.data, drivers, selected, byAge, config.fits, crossings]);

  const bands = useMemo(
    () => (history && timeline && !byAge ? statusBands(history, timeline) : []),
    [history, timeline, byAge]
  );
  const toLap = useMemo(
    () => (history && timeline ? lapAxis(history, timeline) : null),
    [history, timeline]
  );

  if (error ?? deg.error) return <PanelMessage>{(error ?? deg.error)!.message}</PanelMessage>;
  if (!history || !timeline || !chart || !drivers)
    return <PanelMessage>Loading laps…</PanelMessage>;
  if (selected.length === 0)
    return <PanelMessage>Select drivers in this link group to see their pace.</PanelMessage>;

  const stints = (deg.data?.stints ?? []).filter((s) => s.fit && selected.includes(s.driver));
  const compounds = deg.data?.compounds ?? [];
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-1.5 pt-0.5 text-[10px] uppercase text-faint">
        {config.fuel > 0 ? 'Fuel-corrected lap time' : 'Lap time'}
        {byAge ? ' by tyre age' : ''}
      </div>
      {chart.series.length > 0 ? (
        <LapChart
          group={group}
          data={chart.data}
          series={chart.series}
          xRange={chart.xRange}
          yRange={chart.yRange}
          yFormat={yFormat}
          xLabel={byAge ? 'TYRE AGE' : 'LAP'}
          bands={bands}
          clockLap={!byAge && t < timeline.end && toLap ? toLap(t) : null}
          format={formatLapTime}
        />
      ) : (
        <PanelMessage>No clean laps yet at the session clock.</PanelMessage>
      )}
      {config.table ? <StintTable stints={stints} compounds={compounds} drivers={drivers} /> : null}
    </div>
  );
}

function StintTable({
  stints,
  compounds,
  drivers,
}: {
  stints: StintPace[];
  compounds: CompoundPace[];
  drivers: NonNullable<ReturnType<typeof useStrategyClock>['drivers']>;
}) {
  return (
    <div className="max-h-[40%] shrink-0 overflow-auto border-t border-line">
      <table className="w-full whitespace-nowrap text-[11px] tabular-nums">
        <thead>
          <tr>
            <th className={cn(th, 'text-left')}>Drv</th>
            <th className={cn(th, 'text-left')}>Tyre</th>
            <th className={cn(th, 'text-right')}>Laps</th>
            <th className={cn(th, 'text-right')} title="Seconds per lap of tyre age">
              Deg
            </th>
            <th className={cn(th, 'text-right')} title="Fitted lap time on a new set">
              New
            </th>
            <th className={cn(th, 'text-right')} title="Spread of the clean laps around the fit">
              ±
            </th>
          </tr>
        </thead>
        <tbody>
          {stints.map((s) => (
            <tr key={`${s.driver}-${s.stint}`}>
              <DriverCell code={s.driver} drivers={drivers} />
              <td className="px-1.5 py-[1px]">
                <TyreBadge compound={s.compound} />
              </td>
              <td className={cn(td, 'text-dim')}>
                {s.start_lap}–{s.end_lap}
              </td>
              <td className={td}>{s.fit ? formatDeg(s.fit.slope) : ''}</td>
              <td className={cn(td, 'text-dim')}>{s.fit ? formatLapTime(s.fit.base) : ''}</td>
              <td className={cn(td, 'text-faint')}>{s.fit ? s.fit.residual.toFixed(2) : ''}</td>
            </tr>
          ))}
          {compounds.map((c) => (
            <tr key={c.compound} className="text-dim">
              <td className="px-1.5 py-[1px] text-left text-faint" title="All drivers combined">
                FIELD
              </td>
              <td className="px-1.5 py-[1px]">
                <TyreBadge compound={c.compound} />
              </td>
              <td className={cn(td, 'text-faint')}>
                {c.stints}× · {c.laps}
              </td>
              <td className={td}>{formatDeg(c.slope)}</td>
              <td className={td}>{formatLapTime(c.base)}</td>
              <td className={td} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
