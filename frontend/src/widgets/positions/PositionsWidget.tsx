import { useMemo } from 'react';
import type uPlot from 'uplot';
import { LapChart, type LapSeries } from '@/components/chart/LapChart';
import { PanelMessage } from '@/components/data/bits';
import { completedAt, lapAxis, statusBands } from '@/lib/strategy';
import type { WidgetProps } from '../types';
import { crossingsKey, driverStyles, useGroupDrivers, useStrategyClock } from '../useStrategy';
import type { PositionsConfig } from './widget';

const yTicks = (min: number, max: number) => {
  const ticks = [];
  for (let p = Math.max(1, Math.ceil(min)); p <= max; p++)
    if (p === 1 || p % 5 === 0) ticks.push(p);
  return ticks;
};
const yFormat = (v: number) => `P${v}`;
const format = (v: number) => `P${v}`;

export function PositionsWidget({ group, config }: WidgetProps<PositionsConfig>) {
  const { history, timeline, drivers, t, error } = useStrategyClock();
  const selected = useGroupDrivers(group);
  const crossings = crossingsKey(history, t);

  const chart = useMemo(() => {
    if (!history) return null;
    const total = history.total_laps ?? history.leader_line.length;
    const highlight = new Set(selected);
    const shown = history.drivers
      .filter((d) => config.drivers === 'all' || highlight.has(d.driver))
      .sort((a, b) => Number(highlight.has(a.driver)) - Number(highlight.has(b.driver)));
    const styles = driverStyles(
      history.drivers.map((d) => d.driver),
      drivers
    );
    const field = history.drivers.length;
    const laps = Array.from({ length: total + 1 }, (_, i) => i);
    const columns = shown.map((d) => {
      const values: (number | null)[] = laps.map(() => null);
      // Lap 0 is the grid; a pit-lane start (99) goes to the back.
      values[0] = d.grid == null ? null : Math.min(d.grid, field);
      const done = completedAt(d, t);
      for (let i = 0; i < done; i++) {
        if (d.laps[i] <= total) values[d.laps[i]] = d.position[i];
      }
      return values;
    });
    const series: LapSeries[] = shown.map((d) => ({
      label: d.driver,
      ...styles.get(d.driver)!,
      strong: highlight.has(d.driver),
    }));
    return {
      data: [laps, ...columns] as uPlot.AlignedData,
      series,
      total,
      field,
    };
    // `crossings` stands for t: the data only changes when a car crosses the line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, drivers, selected, config.drivers, crossings]);

  const bands = useMemo(
    () => (history && timeline ? statusBands(history, timeline) : []),
    [history, timeline]
  );
  const toLap = useMemo(
    () => (history && timeline ? lapAxis(history, timeline) : null),
    [history, timeline]
  );

  if (error) return <PanelMessage>{error.message}</PanelMessage>;
  if (!history || !timeline || !chart) return <PanelMessage>Loading laps…</PanelMessage>;
  if (history.kind !== 'race')
    return <PanelMessage>The lap chart is for races and sprints.</PanelMessage>;
  if (chart.series.length === 0)
    return <PanelMessage>No drivers selected in this link group.</PanelMessage>;

  return (
    <div className="flex h-full flex-col">
      <LapChart
        group={group}
        data={chart.data}
        series={chart.series}
        xRange={[0, chart.total]}
        yRange={[0.5, chart.field + 0.5]}
        invertY
        yTicks={yTicks}
        yFormat={yFormat}
        bands={bands}
        clockLap={t < timeline.end && toLap ? toLap(t) : null}
        format={format}
      />
    </div>
  );
}
