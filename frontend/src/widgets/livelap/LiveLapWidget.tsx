import { useMemo, useRef, useState } from 'react';
import type uPlot from 'uplot';
import type { LapProgress } from '@/api/client';
import { useLapProgress, useSessionDetail, useTimeline } from '@/api/queries';
import { UPlotChart, type ChartSeries } from '@/components/chart/UPlotChart';
import { NoLapsMessage, PanelMessage } from '@/components/data/bits';
import { COLORS } from '@/lib/colors';
import { formatGap, formatLapTime } from '@/lib/format';
import { useClockTime } from '@/store/clock';
import { useGroupLaps } from '@/store/groups';
import { useClockDraw } from '../hooks';
import type { WidgetProps } from '../types';
import type { LiveLapConfig } from './widget';

const deltaFormat = (v: number) =>
  v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
const THROTTLE_RANGE: [number, number] = [0, 105];

/** The lap is fetched this many seconds ahead of the clock and drawn up to the clock every
 * frame, so the line grows smoothly instead of a second at a time. */
const AHEAD = 2;
/** Seconds the finished lap stays after the line. */
const HOLD = 3;
const SMOOTHING = [1, 2, 3, 2, 1];

type Values = (number | null)[];

/** For drawing only: a triangle over ±10 m (the grid is 5 m) rounds the kinks of 4 Hz samples
 * drawn straight between. The numbers in the header stay raw. */
function smooth(values: Values): Values {
  const r = (SMOOTHING.length - 1) / 2;
  return values.map((v, i) => {
    if (v == null) return null;
    let sum = 0;
    let weight = 0;
    SMOOTHING.forEach((w, k) => {
      const x = values[i + k - r];
      if (x != null) {
        sum += x * w;
        weight += w;
      }
    });
    return sum / weight;
  });
}

/** The last grid point the car had reached `elapsed` seconds into the lap, or -1. */
function reachedAt(time: Values, elapsed: number): number {
  for (let i = time.length - 1; i >= 0; i--) {
    const at = time[i];
    if (at != null && at <= elapsed) return i;
  }
  return -1;
}

const upTo = (values: Values, n: number): Values => values.map((v, i) => (i <= n ? v : null));

/** New data with the y axis fitted to it (not to the part still ahead), keeping the x zoom. */
function set(u: uPlot | null, data: Values[]) {
  if (!u) return;
  const { min, max } = u.scales.x;
  u.batch(() => {
    u.setData(data as uPlot.AlignedData, true);
    if (min != null && max != null) u.setScale('x', { min, max });
  });
}

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
  const t = useClockTime(250);
  const timeline = useTimeline();
  const race = timeline.data?.kind === 'race';
  const reference = config.reference === 'auto' ? (race ? 'previous' : 'best') : config.reference;
  const progress = useLapProgress(driver, t + AHEAD, reference);
  const detail = useSessionDetail();
  const color = detail.data?.drivers.find((d) => d.code === driver)?.color ?? COLORS.text;
  const latest = progress.data?.driver === driver ? progress.data : undefined;
  // Fetched ahead, the next lap arrives before the clock is on it. Until then, and a few seconds
  // after the line (its delta there is the lap time gap), the lap before, asked at its end.
  const holding = latest != null && t < latest.start + HOLD;
  const finished = useLapProgress(
    holding ? driver : undefined,
    (latest?.start ?? 0) - 0.001,
    reference,
    true
  ).data;
  // While that loads, whatever was on screen if it is that lap.
  const [shown, setShown] = useState<LapProgress | undefined>(undefined);
  const previous = (p: LapProgress | undefined) =>
    holding && p?.driver === driver && p.lap === latest.lap - 1;
  const data = previous(finished) ? finished : previous(shown) ? shown : latest;
  if (data !== shown) setShown(data);

  const charts = useMemo(() => {
    if (!data) return null;
    const x = data.distance;
    const current: ChartSeries = { color, width: 1.5 };
    const speed = smooth(data.speed);
    // An out-lap counts from the garage or the pit lane: its delta says nothing.
    const delta = data.out_lap ? data.delta.map(() => null) : smooth(data.delta);
    const reference = data.reference ? smooth(data.reference.speed) : null;
    return {
      x,
      speed,
      reference,
      throttle: data.throttle,
      delta,
      speedChart: {
        data: (reference ? [x, speed, reference] : [x, speed]) as uPlot.AlignedData,
        series: data.reference ? [current, { color, dash: [6, 4], width: 1 }] : [current],
      },
      throttleChart: { data: [x, data.throttle] as uPlot.AlignedData, series: [current] },
      deltaChart: { data: [x, delta] as uPlot.AlignedData, series: [current] },
    };
  }, [data, color]);

  const speedRef = useRef<uPlot | null>(null);
  const throttleRef = useRef<uPlot | null>(null);
  const deltaRef = useRef<uPlot | null>(null);
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const kmRef = useRef<HTMLSpanElement>(null);
  const gapRef = useRef<HTMLSpanElement>(null);

  // Every frame: the lines up to where the car is at the clock, and the numbers there.
  const draw = useMemo(() => {
    if (!data || !charts) return null;
    let drawn = -2;
    // A chart built again (another group, throttle switched on) starts from the whole answer.
    let on: (uPlot | null)[] = [];
    return (now: number) => {
      const elapsed = Math.min(Math.max(now - data.start, 0), data.elapsed);
      const n = reachedAt(data.time, elapsed);
      if (elapsedRef.current) elapsedRef.current.textContent = formatElapsed(elapsed);
      const instances = [speedRef.current, throttleRef.current, deltaRef.current];
      if (n === drawn && instances.every((u, i) => u === on[i])) return;
      drawn = n;
      on = instances;
      const { x } = charts;
      const speed = upTo(charts.speed, n);
      set(speedRef.current, charts.reference ? [x, speed, charts.reference] : [x, speed]);
      set(throttleRef.current, [x, upTo(charts.throttle, n)]);
      set(deltaRef.current, [x, upTo(charts.delta, n)]);
      if (kmRef.current) kmRef.current.textContent = `${((n < 0 ? 0 : x[n]) / 1000).toFixed(2)} km`;
      const gap =
        data.out_lap || n < 0
          ? null
          : (data.delta.slice(0, n + 1).findLast((v) => v != null) ?? null);
      if (gapRef.current) {
        gapRef.current.textContent = gap == null ? '' : formatGap(gap);
        gapRef.current.style.color =
          gap == null ? COLORS.textFaint : gap < 0 ? COLORS.pb : COLORS.slow;
      }
    };
  }, [data, charts]);
  useClockDraw(draw);

  if (!driver) return <NoLapsMessage group={group} />;
  if (progress.error && !data) return <PanelMessage>{progress.error.message}</PanelMessage>;
  if (!data || !charts) return <PanelMessage>Loading…</PanelMessage>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 px-1.5 py-0.5 text-[11px] tabular-nums">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-[3px]" style={{ background: color }} />
          <span className="font-semibold">{data.driver}</span>
          <span className="text-dim">LAP {data.lap}</span>
        </span>
        <span ref={elapsedRef} />
        <span ref={kmRef} className="text-dim" />
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
          title="Time behind the reference lap at the car's position"
          ref={gapRef}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 border-t border-line" style={{ flex: 3 }}>
          <UPlotChart
            group={group}
            data={charts.speedChart.data}
            series={charts.speedChart.series}
            chartRef={speedRef}
            label="Speed km/h"
          />
        </div>
        {config.throttle ? (
          <div className="flex min-h-0 border-t border-line" style={{ flex: 1.2 }}>
            <UPlotChart
              group={group}
              data={charts.throttleChart.data}
              series={charts.throttleChart.series}
              chartRef={throttleRef}
              label="Throttle %"
              yRange={THROTTLE_RANGE}
            />
          </div>
        ) : null}
        <div className="flex min-h-0 border-t border-line" style={{ flex: 2 }}>
          <UPlotChart
            group={group}
            data={charts.deltaChart.data}
            series={charts.deltaChart.series}
            chartRef={deltaRef}
            label="Delta s"
            yFormat={deltaFormat}
            showXAxis
          />
        </div>
      </div>
    </div>
  );
}
