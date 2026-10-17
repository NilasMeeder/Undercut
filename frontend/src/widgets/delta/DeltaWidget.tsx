import { useMemo } from 'react';
import type uPlot from 'uplot';
import { UPlotChart, type ChartSeries } from '@/components/chart/UPlotChart';
import { LineSwatch, NoLapsMessage, PanelMessage } from '@/components/data/bits';
import { formatGap } from '@/lib/format';
import type { WidgetProps } from '../types';
import { useGroupComparison } from '../useGroupComparison';
import type { DeltaConfig } from './widget';

const deltaFormat = (v: number) =>
  v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;

/** Time behind the reference lap (the first selected) along the lap; above zero = slower. */
export function DeltaWidget({ group, config }: WidgetProps<DeltaConfig>) {
  const { laps, data, styles, error } = useGroupComparison(group, { step: config.step });

  const chart = useMemo(() => {
    if (!data) return null;
    const series: ChartSeries[] = styles.map((s, i) => ({
      color: s.color,
      dash: s.dash,
      width: i === 0 ? 1 : 1.5,
    }));
    return { data: [data.distance, ...data.laps.map((l) => l.delta)] as uPlot.AlignedData, series };
  }, [data, styles]);

  if (laps.length === 0) return <NoLapsMessage group={group} />;
  if (laps.length === 1) return <PanelMessage>Select a second lap to see the delta.</PanelMessage>;
  if (error) return <PanelMessage>{error.message}</PanelMessage>;
  if (!data || !chart) return <PanelMessage>Loading…</PanelMessage>;

  const reference = data.laps[0];
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap gap-x-3 px-1.5 py-0.5 text-[11px]">
        {data.laps.map((lap, i) => (
          <span key={`${lap.driver}-${lap.lap}`} className="flex items-center gap-1.5">
            <LineSwatch color={styles[i].color} dash={styles[i].dash} />
            {lap.driver} L{lap.lap}
            <span className="text-dim">{i === 0 ? 'ref' : formatGap(lap.delta.at(-1))}</span>
          </span>
        ))}
        <span className="ml-auto text-faint">
          vs {reference.driver} L{reference.lap}
        </span>
      </div>
      <UPlotChart
        group={group}
        data={chart.data}
        series={chart.series}
        label="Delta s"
        yFormat={deltaFormat}
        showXAxis
      />
    </div>
  );
}
