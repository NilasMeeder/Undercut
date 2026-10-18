import { useMemo } from 'react';
import type uPlot from 'uplot';
import { useLapProgress, useSessionDetail, useTimeline } from '@/api/queries';
import { UPlotChart, type ChartSeries } from '@/components/chart/UPlotChart';
import { NoLapsMessage, PanelMessage } from '@/components/data/bits';
import { COLORS } from '@/lib/colors';
import { formatGap, formatLapTime } from '@/lib/format';
import { useClockTime } from '@/store/clock';
import { useGroupLaps } from '@/store/groups';
import type { WidgetProps } from '../types';
import type { LiveLapConfig } from './widget';

const deltaFormat = (v: number) =>
  v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
const THROTTLE_RANGE: [number, number] = [0, 105];

/** m:ss.s into the lap. */
function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, '0')}`;
}

/**
 * The lap the group's driver is on at the clock, as far as it got, over a finished lap of the
 * same driver, with the delta at the car's position (backend: /lap-progress).
 */
export function LiveLapWidget({ group, config }: WidgetProps<LiveLapConfig>) {
  const laps = useGroupLaps(group);
  const driver = laps[0]?.driver;
  const t = useClockTime(1000);
  const timeline = useTimeline();
  const race = timeline.data?.kind === 'race';
  const reference = config.reference === 'auto' ? (race ? 'previous' : 'best') : config.reference;
  const progress = useLapProgress(driver, t, reference);
  const detail = useSessionDetail();
  const color = detail.data?.drivers.find((d) => d.code === driver)?.color ?? COLORS.text;
  const data = progress.data?.driver === driver ? progress.data : undefined;

  const charts = useMemo(() => {
    if (!data) return null;
    const x = data.distance;
    const current: ChartSeries = { color, width: 1.5 };
    const speed = data.reference
      ? {
          data: [x, data.speed, data.reference.speed] as uPlot.AlignedData,
          series: [current, { color, dash: [6, 4], width: 1 }],
        }
      : { data: [x, data.speed] as uPlot.AlignedData, series: [current] };
    return {
      speed,
      throttle: { data: [x, data.throttle] as uPlot.AlignedData, series: [current] },
      // An out-lap counts from the garage or the pit lane: its delta says nothing.
      delta: {
        data: [x, data.out_lap ? data.delta.map(() => null) : data.delta] as uPlot.AlignedData,
        series: [current],
      },
    };
  }, [data, color]);

  if (!driver) return <NoLapsMessage group={group} />;
  if (progress.error && !data) return <PanelMessage>{progress.error.message}</PanelMessage>;
  if (!data || !charts) return <PanelMessage>Loading…</PanelMessage>;

  const now = data.out_lap ? null : (data.delta.findLast((v) => v != null) ?? null);
  const tone = now == null ? COLORS.textFaint : now < 0 ? COLORS.pb : COLORS.slow;
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 px-1.5 py-0.5 text-[11px] tabular-nums">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-[3px]" style={{ background: color }} />
          <span className="font-semibold">{data.driver}</span>
          <span className="text-dim">LAP {data.lap}</span>
        </span>
        <span>{formatElapsed(data.elapsed)}</span>
        <span className="text-dim">{(data.progress / 1000).toFixed(2)} km</span>
        {data.out_lap ? (
          <span className="text-[10px] font-semibold text-faint">OUT LAP</span>
        ) : null}
        {progress.error ? (
          <span className="truncate text-faint" title={progress.error.message}>
            {progress.error.message}
          </span>
        ) : null}
        <span className="ml-auto text-faint">
          {data.reference
            ? `vs L${data.reference.lap} ${formatLapTime(data.reference.lap_time)}`
            : 'no finished lap to compare'}
        </span>
        <span
          className="min-w-[76px] text-right text-[18px] font-semibold leading-6"
          style={{ color: tone }}
          title="Time behind the reference lap at the car's position"
        >
          {now == null ? '' : formatGap(now)}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 border-t border-line" style={{ flex: 3 }}>
          <UPlotChart
            group={group}
            data={charts.speed.data}
            series={charts.speed.series}
            label="Speed km/h"
          />
        </div>
        {config.throttle ? (
          <div className="flex min-h-0 border-t border-line" style={{ flex: 1.2 }}>
            <UPlotChart
              group={group}
              data={charts.throttle.data}
              series={charts.throttle.series}
              label="Throttle %"
              yRange={THROTTLE_RANGE}
            />
          </div>
        ) : null}
        <div className="flex min-h-0 border-t border-line" style={{ flex: 2 }}>
          <UPlotChart
            group={group}
            data={charts.delta.data}
            series={charts.delta.series}
            label="Delta s"
            yFormat={deltaFormat}
            showXAxis
          />
        </div>
      </div>
    </div>
  );
}
