import { useMemo, useRef } from 'react';
import type { SessionTimeline, TrackEvolution } from '@/api/client';
import { useSessionDetail, useTimeline, useTrackEvolution } from '@/api/queries';
import { PanelMessage } from '@/components/data/bits';
import { COLORS } from '@/lib/colors';
import { formatLapTime } from '@/lib/format';
import { formatClock } from '@/lib/replay';
import { rowStyle, td, th } from '@/lib/table';
import { cn } from '@/lib/utils';
import { useClockTime } from '@/store/clock';
import { useLapSelection } from '@/store/groups';
import { useSelection } from '@/store/selection';
import { useElementSize } from '../hooks';
import type { WidgetProps } from '../types';
import { useLapsAtClock } from '../useLapsAtClock';
import type { EvolutionConfig } from './widget';

const QUALIFYING = ['Q', 'SQ', 'SS'];
const PAD = { left: 40, right: 10, top: 14, bottom: 18 };
/** Dots further than this from the curve's range are drawn at the edge. */
const MARGIN = 0.5;

const seconds = (v: number) => `${v < 0 ? '−' : v > 0 ? '+' : ''}${Math.abs(v).toFixed(2)}`;

/** The qualifying part a moment falls in ('Q2'), or ''. */
function segmentAt(timeline: SessionTimeline | undefined, t: number): string {
  return timeline?.segments.find((s) => s.start <= t && t <= s.end)?.name ?? '';
}

export function EvolutionWidget({ group, config }: WidgetProps<EvolutionConfig>) {
  const session = useSelection((s) => s.session);
  const qualifying = session != null && QUALIFYING.includes(session);
  const laps = useLapsAtClock(config.scope);
  // Only the laps done at the clock: the cutoff is the last of them to end (null = all).
  const until = useMemo(() => {
    if (!laps.data) return undefined;
    if (!laps.cut) return null;
    return laps.data.reduce((m, l) => Math.max(m, l.end_time ?? 0), 0);
  }, [laps.data, laps.cut]);
  const evolution = useTrackEvolution(until, qualifying);
  const timeline = useTimeline().data;
  const drivers = useSessionDetail().data?.drivers;
  const box = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(box);

  if (!qualifying) return <PanelMessage>Track evolution is for qualifying.</PanelMessage>;
  const data = evolution.data;
  const colorOf = (code: string) => drivers?.find((d) => d.code === code)?.color ?? COLORS.text;

  return (
    <div className="flex h-full flex-col">
      {data ? <Summary data={data} /> : null}
      <div ref={box} className="relative min-h-[90px] flex-[3]">
        {evolution.error && !data ? (
          <PanelMessage>{evolution.error.message}</PanelMessage>
        ) : !data ? (
          <PanelMessage>Loading laps…</PanelMessage>
        ) : width > 0 && height > 0 ? (
          <Plot data={data} timeline={timeline} width={width} height={height} colorOf={colorOf} />
        ) : null}
      </div>
      {data ? (
        <div className="min-h-0 flex-[2] overflow-auto border-t border-line">
          <Table data={data} timeline={timeline} group={group} colorOf={colorOf} />
        </div>
      ) : null}
    </div>
  );
}

function Summary({ data }: { data: TrackEvolution }) {
  return (
    <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 px-1.5 py-0.5 text-[11px] tabular-nums">
      <span>
        TRACK <span className="font-semibold">{seconds(data.total)} s</span>
      </span>
      <span className="text-dim">
        last {data.recent_minutes} min {seconds(data.recent)} s
      </span>
      <span className="ml-auto text-faint" title="Robust spread of a push lap around the fit">
        ±{data.spread.toFixed(2)} s per lap
      </span>
    </div>
  );
}

function Plot({
  data,
  timeline,
  width,
  height,
  colorOf,
}: {
  data: TrackEvolution;
  timeline: SessionTimeline | undefined;
  width: number;
  height: number;
  colorOf: (code: string) => string;
}) {
  const t = useClockTime(1000);
  const x0 = data.times[0];
  const x1 = Math.max(data.times.at(-1) ?? x0 + 1, x0 + 60);
  const low = Math.min(...data.gain);
  const high = Math.max(...data.gain);
  const y0 = low - MARGIN;
  const y1 = high + MARGIN;
  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = Math.max(height - PAD.top - PAD.bottom, 1);
  const sx = (v: number) => PAD.left + ((v - x0) / (x1 - x0)) * plotW;
  const sy = (v: number) =>
    PAD.top + (1 - (Math.min(Math.max(v, y0), y1) - y0) / (y1 - y0)) * plotH;
  const curve = data.times.map((x, i) => `${sx(x).toFixed(1)},${sy(data.gain[i]).toFixed(1)}`);
  const yStep = y1 - y0 > 2 ? 0.5 : y1 - y0 > 1 ? 0.25 : 0.1;
  const yTicks = [];
  for (let v = Math.ceil(y0 / yStep) * yStep; v <= y1; v += yStep) yTicks.push(v);
  const xTicks = [];
  for (let v = Math.ceil(x0 / 600) * 600; v <= x1; v += 600) xTicks.push(v);
  const segments = (timeline?.segments ?? []).filter((s) => s.end > x0 && s.start < x1);

  return (
    <svg width={width} height={height} className="block text-[10px] tabular-nums">
      {segments.map((s) => (
        <text
          key={s.name}
          x={sx(Math.max(s.start, x0)) + 3}
          y={PAD.top - 3}
          fill={COLORS.textFaint}
        >
          {s.name}
        </text>
      ))}
      {segments.slice(1).map((s) => (
        <line
          key={s.name}
          x1={sx(s.start)}
          x2={sx(s.start)}
          y1={PAD.top}
          y2={PAD.top + plotH}
          stroke={COLORS.textFaint}
          strokeDasharray="2 3"
        />
      ))}
      {yTicks.map((v) => (
        <g key={`y${v.toFixed(2)}`}>
          <line x1={PAD.left} x2={PAD.left + plotW} y1={sy(v)} y2={sy(v)} stroke={COLORS.line} />
          <text x={PAD.left - 4} y={sy(v) + 3} textAnchor="end" fill={COLORS.textFaint}>
            {seconds(v)}
          </text>
        </g>
      ))}
      {xTicks.map((v) => (
        <text key={v} x={sx(v)} y={height - 5} textAnchor="middle" fill={COLORS.textFaint}>
          {formatClock(v)}
        </text>
      ))}
      {data.points.map((p) => (
        <circle
          key={`${p.driver}-${p.lap}`}
          cx={sx(p.time)}
          cy={sy(p.gain)}
          r={2.5}
          fill={colorOf(p.driver)}
          opacity={0.75}
        >
          <title>{`${p.driver} L${p.lap}: ${seconds(p.gain)} s after his level and tyre`}</title>
        </circle>
      ))}
      <polyline points={curve.join(' ')} fill="none" stroke={COLORS.text} strokeWidth={1.5} />
      {t > x0 && t < x1 ? (
        <line
          x1={sx(t)}
          x2={sx(t)}
          y1={PAD.top}
          y2={PAD.top + plotH}
          stroke={COLORS.textDim}
          strokeWidth={1}
        />
      ) : null}
    </svg>
  );
}

function Table({
  data,
  timeline,
  group,
  colorOf,
}: {
  data: TrackEvolution;
  timeline: SessionTimeline | undefined;
  group: WidgetProps<EvolutionConfig>['group'];
  colorOf: (code: string) => string;
}) {
  const { isSelected, toggle } = useLapSelection(group);
  const byTime = [...data.drivers].sort((a, b) => a.lap_time - b.lap_time).map((d) => d.driver);
  return (
    <table className="w-full whitespace-nowrap text-[11px] tabular-nums">
      <thead>
        <tr>
          <th className={cn(th, 'text-right')}>P</th>
          <th className={cn(th, 'text-left')}>Drv</th>
          <th className={cn(th, 'text-right')}>Best</th>
          <th className={cn(th, 'text-left')} title="When he set it">
            At
          </th>
          <th className={cn(th, 'text-right')} title="What the track gained after his best lap">
            Track
          </th>
          <th className={cn(th, 'text-right')} title="His best lap on the track of the end">
            Worth
          </th>
          <th className={cn(th, 'text-right')} title="Places that would have moved him">
            ±
          </th>
        </tr>
      </thead>
      <tbody>
        {data.drivers.map((d, i) => {
          const ref = { driver: d.driver, lap: d.lap };
          const selected = isSelected(ref);
          const moved = byTime.indexOf(d.driver) - i;
          const after = data.total - d.gain;
          return (
            <tr
              key={d.driver}
              onClick={() => toggle(ref)}
              style={rowStyle(selected, group)}
              className={cn('cursor-pointer hover:bg-raised', selected && 'bg-raised')}
              title={`${d.driver} L${d.lap} ${formatLapTime(d.lap_time)}: the track gained ${after.toFixed(3)} s after it`}
            >
              <td className={cn(td, 'text-faint')}>{i + 1}</td>
              <td className="px-1.5 py-[1px] text-left font-semibold">
                <span
                  className="mr-1 inline-block h-2.5 w-[3px] align-[-1px]"
                  style={{ background: colorOf(d.driver) }}
                />
                {d.driver}
              </td>
              <td className={cn(td, 'text-dim')}>{formatLapTime(d.lap_time)}</td>
              <td className="px-1.5 py-[1px] text-left text-faint">
                {segmentAt(timeline, d.time)} {formatClock(d.time)}
              </td>
              <td className={cn(td, 'text-dim')}>{after.toFixed(3)}</td>
              <td className={cn(td, 'text-text')}>{formatLapTime(d.worth)}</td>
              <td className={cn(td, moved === 0 ? 'text-faint' : 'text-dim')}>
                {moved > 0 ? `▲${moved}` : moved < 0 ? `▼${-moved}` : '–'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
