import { useMemo, useRef } from 'react';
import type { LapProgress } from '@/api/client';
import type uPlot from 'uplot';
import { useSessionDetail } from '@/api/queries';
import { UPlotChart, type ChartSeries } from '@/components/chart/UPlotChart';
import { NoLapsMessage, PanelMessage } from '@/components/data/bits';
import { COLORS } from '@/lib/colors';
import { formatGap, formatLapTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useGroupLaps } from '@/store/groups';
import { useClockDraw } from '../hooks';
import { driverStyles } from '../useStrategy';
import type { WidgetProps } from '../types';
import { progressAt, useLiveLap } from './useLiveLap';
import type { LiveLapConfig } from './widget';

const deltaFormat = (v: number) =>
  v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
const THROTTLE_RANGE: [number, number] = [0, 105];
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

/** At most this many drivers at once (one useLiveLap each). */
const MAX_DRIVERS = 4;

const padded = (values: Values, length: number): Values =>
  values.length >= length ? values : [...values, ...Array<null>(length - values.length).fill(null)];

/**
 * The lap each driver of the group is on at the clock, as far as it got, on one distance axis,
 * each with the delta to his own reference lap (backend: /lap-progress). With one driver his
 * reference lap is drawn too (dashed).
 */
export function LiveLapWidget({ group, config }: WidgetProps<LiveLapConfig>) {
  const laps = useGroupLaps(group);
  const codes = useMemo(() => {
    const unique = [...new Set(laps.map((l) => l.driver))];
    return config.drivers === 'first' ? unique.slice(0, 1) : unique.slice(0, MAX_DRIVERS);
  }, [laps, config.drivers]);
  // A fixed number of hooks; the slots past the drivers ask for nothing.
  const p0 = useLiveLap(codes[0], config.reference);
  const p1 = useLiveLap(codes[1], config.reference);
  const p2 = useLiveLap(codes[2], config.reference);
  const p3 = useLiveLap(codes[3], config.reference);
  const [d0, d1, d2, d3] = [p0.data, p1.data, p2.data, p3.data];
  const progresses = [p0, p1, p2, p3].slice(0, codes.length);
  const error = progresses.find((p) => p.error && !p.data)?.error;
  const detail = useSessionDetail();
  const styles = useMemo(() => driverStyles(codes, detail.data?.drivers), [codes, detail.data]);

  const charts = useMemo(() => {
    const rows = [d0, d1, d2, d3]
      .slice(0, codes.length)
      .filter((d): d is LapProgress => d != null && codes.includes(d.driver));
    if (rows.length === 0) return null;
    const longest = rows.reduce((a, b) => (b.distance.length > a.distance.length ? b : a));
    const x = longest.distance;
    const lines = rows.map((d) => {
      const style = styles.get(d.driver) ?? { color: COLORS.text, dash: undefined };
      return {
        data: d,
        series: { color: style.color, dash: style.dash, width: 1.5 } as ChartSeries,
        speed: padded(smooth(d.speed), x.length),
        throttle: padded(d.throttle, x.length),
        // An out-lap counts from the garage or the pit lane: its delta says nothing.
        delta: padded(d.out_lap ? d.delta.map(() => null) : smooth(d.delta), x.length),
      };
    });
    const only = rows.length === 1 ? rows[0] : null;
    const reference = only?.reference ? padded(smooth(only.reference.speed), x.length) : null;
    const speedSeries = lines.map((l) => l.series);
    if (reference) speedSeries.push({ color: lines[0].series.color, dash: [6, 4], width: 1 });
    return {
      x,
      lines,
      reference,
      speedSeries,
      speedData: [x, ...lines.map((l) => l.speed), ...(reference ? [reference] : [])],
      throttleData: [x, ...lines.map((l) => l.throttle)],
      deltaData: [x, ...lines.map((l) => l.delta)],
    };
  }, [d0, d1, d2, d3, codes, styles]);

  const speedRef = useRef<uPlot | null>(null);
  const throttleRef = useRef<uPlot | null>(null);
  const deltaRef = useRef<uPlot | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  // Every frame: the lines up to where each car is at the clock, and the numbers there.
  const draw = useMemo(() => {
    if (!charts) return null;
    let drawn = '';
    // A chart built again (another group, throttle switched on) starts from the whole answer.
    let on: (uPlot | null)[] = [];
    return (now: number) => {
      const at = charts.lines.map((l) => progressAt(l.data, now));
      const field = (i: number, name: string) =>
        headerRef.current?.querySelector<HTMLElement>(`[data-row="${i}"] [data-f="${name}"]`);
      at.forEach(({ elapsed }, i) => {
        const el = field(i, 'elapsed');
        if (el) el.textContent = formatElapsed(elapsed);
      });
      const instances = [speedRef.current, throttleRef.current, deltaRef.current];
      const key = at.map((a) => a.n).join(',');
      if (key === drawn && instances.every((u, i) => u === on[i])) return;
      drawn = key;
      on = instances;
      const { x, lines } = charts;
      const cut = (pick: (l: (typeof lines)[number]) => Values) =>
        lines.map((l, i) => upTo(pick(l), at[i].n));
      set(speedRef.current, [
        x,
        ...cut((l) => l.speed),
        ...(charts.reference ? [charts.reference] : []),
      ]);
      set(throttleRef.current, [x, ...cut((l) => l.throttle)]);
      set(deltaRef.current, [x, ...cut((l) => l.delta)]);
      at.forEach(({ n, gap }, i) => {
        const { data } = lines[i];
        const km = field(i, 'km');
        if (km) km.textContent = `${((n < 0 ? 0 : data.distance[n]) / 1000).toFixed(2)} km`;
        // On course for: the reference lap plus the delta here (from 300 m, like the tower's Pred).
        const predicted = field(i, 'predicted');
        if (predicted) {
          const lapTime = data.reference?.lap_time;
          const far = n >= 0 && data.distance[n] >= 300;
          predicted.textContent =
            gap != null && lapTime != null && far ? `→ ${formatLapTime(lapTime + gap)}` : '';
        }
        const delta = field(i, 'gap');
        if (delta) {
          delta.textContent = gap == null ? '' : formatGap(gap);
          delta.style.color = gap == null ? COLORS.textFaint : gap < 0 ? COLORS.pb : COLORS.slow;
        }
      });
    };
  }, [charts]);
  useClockDraw(draw);

  if (codes.length === 0) return <NoLapsMessage group={group} />;
  if (error && !charts) return <PanelMessage>{error.message}</PanelMessage>;
  if (!charts) return <PanelMessage>Loading…</PanelMessage>;
  const single = charts.lines.length === 1;

  return (
    <div className="flex h-full flex-col">
      <div ref={headerRef} className="shrink-0">
        {charts.lines.map(({ data, series }, i) => (
          <div
            key={data.driver}
            data-row={i}
            className="flex items-center gap-3 px-1.5 py-0.5 text-[11px] tabular-nums"
          >
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-[3px]" style={{ background: series.color }} />
              <span className="font-semibold">{data.driver}</span>
              <span className="text-dim">LAP {data.lap}</span>
            </span>
            <span data-f="elapsed" />
            <span data-f="km" className="text-dim" />
            {data.out_lap ? (
              <span className="text-[10px] font-semibold text-faint">OUT LAP</span>
            ) : null}
            {i === 0 && error ? (
              <span className="truncate text-faint" title={error.message}>
                {error.message}
              </span>
            ) : null}
            <span className="ml-auto text-faint">
              {data.reference
                ? `vs L${data.reference.lap} ${formatLapTime(data.reference.lap_time)}`
                : 'no finished lap to compare'}
            </span>
            <span
              data-f="predicted"
              className="text-dim"
              title="On course for: the reference lap time plus the delta at the car's position"
            />
            <span
              data-f="gap"
              className={cn(
                'text-right font-semibold',
                single ? 'min-w-[76px] text-[18px] leading-6' : 'min-w-[60px] text-[14px] leading-5'
              )}
              title="Time behind the reference lap at the car's position"
            />
          </div>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 border-t border-line" style={{ flex: 3 }}>
          <UPlotChart
            group={group}
            data={charts.speedData as uPlot.AlignedData}
            series={charts.speedSeries}
            chartRef={speedRef}
            label="Speed km/h"
          />
        </div>
        {config.throttle ? (
          <div className="flex min-h-0 border-t border-line" style={{ flex: 1.2 }}>
            <UPlotChart
              group={group}
              data={charts.throttleData as uPlot.AlignedData}
              series={charts.lines.map((l) => l.series)}
              chartRef={throttleRef}
              label="Throttle %"
              yRange={THROTTLE_RANGE}
            />
          </div>
        ) : null}
        <div className="flex min-h-0 border-t border-line" style={{ flex: 2 }}>
          <UPlotChart
            group={group}
            data={charts.deltaData as uPlot.AlignedData}
            series={charts.lines.map((l) => l.series)}
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
