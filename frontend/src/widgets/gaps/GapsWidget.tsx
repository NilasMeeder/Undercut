import { useMemo } from 'react';
import type uPlot from 'uplot';
import { LapChart, type LapSeries } from '@/components/chart/LapChart';
import { PanelMessage } from '@/components/data/bits';
import { formatGap } from '@/lib/format';
import { completedAt, lapAxis, statusBands } from '@/lib/strategy';
import type { WidgetProps } from '../types';
import { crossingsKey, driverStyles, useGroupDrivers, useStrategyClock } from '../useStrategy';
import type { GapsConfig } from './widget';

const yFormat = (v: number) => (v === 0 ? '0' : formatGap(v).replace(/\.\d+$/, ''));

export function GapsWidget({ group, config }: WidgetProps<GapsConfig>) {
  const { history, timeline, drivers, t, error } = useStrategyClock();
  const selected = useGroupDrivers(group);
  const reference = config.reference === 'driver' ? (selected[0] ?? null) : null;
  const crossings = crossingsKey(history, t);

  const chart = useMemo(() => {
    if (!history || !timeline) return null;
    const total = history.total_laps ?? history.leader_line.length;
    const highlight = new Set(selected);
    const shown = history.drivers
      .filter((d) => config.drivers === 'all' || highlight.has(d.driver))
      // Highlighted lines last, so they are drawn on top.
      .sort((a, b) => Number(highlight.has(a.driver)) - Number(highlight.has(b.driver)));
    const styles = driverStyles(
      history.drivers.map((d) => d.driver),
      drivers
    );
    const laps = Array.from({ length: total }, (_, i) => i + 1);
    const ref = history.drivers.find((d) => d.driver === reference);
    const refGap = new Map<number, number>();
    if (ref) {
      const done = completedAt(ref, t);
      ref.laps.slice(0, done).forEach((lap, i) => {
        const gap = ref.gap[i];
        if (gap != null) refGap.set(lap, gap);
      });
    }
    const columns = shown.map((d) => {
      const values: (number | null)[] = laps.map(() => null);
      const done = completedAt(d, t);
      for (let i = 0; i < done; i++) {
        const gap = d.gap[i];
        const base = ref ? refGap.get(d.laps[i]) : 0;
        if (gap != null && base != null && d.laps[i] <= total) values[d.laps[i] - 1] = gap - base;
      }
      return values;
    });
    // About one lap time: further back is lapped, off the bottom of the chart.
    const lapTime =
      history.leader_line.length > 1
        ? (history.leader_line.at(-1)! - history.leader_line[0]) / (history.leader_line.length - 1)
        : 100;
    const all = columns.flat().filter((v) => v != null);
    const strong = columns.filter((_, i) => highlight.has(shown[i].driver)).flat();
    const low = Math.min(0, ...all);
    // Room for the highlighted drivers (at least 30 s); the rest may run off the bottom.
    const focus = strong.length
      ? Math.max(30, Math.max(...strong.filter((v) => v != null)) * 1.15)
      : Infinity;
    const high = Math.min(Math.max(1, ...all), focus, ref ? lapTime : lapTime * 0.9);
    const series: LapSeries[] = shown.map((d) => ({
      label: d.driver,
      ...styles.get(d.driver)!,
      strong: highlight.has(d.driver),
    }));
    return {
      data: [laps, ...columns] as uPlot.AlignedData,
      series,
      total,
      yRange: [Math.floor(Math.max(low, ref ? -lapTime : -Infinity)), Math.ceil(high)] as [
        number,
        number,
      ],
    };
    // `crossings` stands for t: the data only changes when a car crosses the line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, timeline, drivers, selected, reference, config.drivers, crossings]);

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
  if (history.kind !== 'race') return <PanelMessage>Gaps are for races and sprints.</PanelMessage>;
  if (config.reference === 'driver' && !reference)
    return <PanelMessage>Select a driver in this link group to measure the gaps to.</PanelMessage>;
  if (chart.series.length === 0)
    return <PanelMessage>No drivers selected in this link group.</PanelMessage>;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-1.5 pt-0.5 text-[10px] uppercase text-faint">
        Gap to {reference ?? 'the leader'} (s)
      </div>
      <LapChart
        group={group}
        data={chart.data}
        series={chart.series}
        xRange={[1, chart.total]}
        yRange={chart.yRange}
        invertY
        yFormat={yFormat}
        bands={bands}
        clockLap={t < timeline.end && toLap ? toLap(t) : null}
        format={formatGap}
      />
    </div>
  );
}
