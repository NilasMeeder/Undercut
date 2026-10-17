import { useMemo } from 'react';
import type { Lap, Weather } from '@/api/client';
import { useLaps, useSessionDetail, useWeather } from '@/api/queries';
import { PanelMessage } from '@/components/data/bits';
import { COLORS } from '@/lib/colors';
import { td, th } from '@/lib/table';
import { lapStyles } from '@/lib/timing';
import { cn } from '@/lib/utils';
import { useClockTime } from '@/store/clock';
import { useGroupLaps, type LapRef } from '@/store/groups';
import type { WidgetProps } from '../types';

type Row = { label: string; unit: string; values: number[]; digits: number };

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8];

/** Mean of directions on a circle: the plain mean of 350° and 10° would be 180°. */
function meanDirection(degrees: number[]): number {
  const rad = degrees.map((d) => (d * Math.PI) / 180);
  const sin = rad.reduce((a, r) => a + Math.sin(r), 0);
  const cos = rad.reduce((a, r) => a + Math.cos(r), 0);
  return Math.round(((Math.atan2(sin, cos) * 180) / Math.PI + 360) % 360);
}

function interpolate(times: number[], values: number[], t: number): number {
  if (t <= times[0]) return values[0];
  for (let i = 1; i < times.length; i++) {
    if (t <= times[i]) {
      const f = (t - times[i - 1]) / (times[i] - times[i - 1]);
      return values[i - 1] + f * (values[i] - values[i - 1]);
    }
  }
  return values[values.length - 1];
}

function Sparkline({
  times,
  values,
  marks,
  now,
}: {
  times: number[];
  values: number[];
  marks: { t: number; color: string }[];
  /** The session clock: a white tick. */
  now: number;
}) {
  const w = 120;
  const h = 14;
  const [t0, t1] = [times[0], times[times.length - 1]];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * w;
  const y = (v: number) => h - 1 - ((v - lo) / (hi - lo || 1)) * (h - 2);
  const points = times.map((t, i) => `${x(t).toFixed(1)},${y(values[i]).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} className="block" aria-hidden>
      <polyline points={points} fill="none" stroke={COLORS.textDim} strokeWidth="1" />
      {marks
        .filter((m) => m.t >= t0 && m.t <= t1)
        .map((m, i) => (
          <line key={i} x1={x(m.t)} x2={x(m.t)} y1={0} y2={h} stroke={m.color} strokeWidth="1" />
        ))}
      {now >= t0 && now < t1 ? (
        <line x1={x(now)} x2={x(now)} y1={0} y2={h} stroke={COLORS.text} strokeWidth="1" />
      ) : null}
    </svg>
  );
}

function startTimes(laps: Lap[] | undefined, refs: LapRef[]): (number | null)[] {
  return refs.map(
    (r) => laps?.find((l) => l.driver === r.driver && l.lap === r.lap)?.start_time ?? null
  );
}

export function WeatherWidget({ group }: WidgetProps<Record<string, never>>) {
  const weather = useWeather();
  const laps = useLaps();
  const detail = useSessionDetail();
  const refs = useGroupLaps(group);
  const now = useClockTime(1000);

  const marks = useMemo(() => {
    const styles = lapStyles(refs, detail.data?.drivers);
    return startTimes(laps.data, refs).flatMap((t, i) =>
      t == null ? [] : [{ t, color: styles[i].color }]
    );
  }, [refs, laps.data, detail.data]);

  if (weather.error) return <PanelMessage>{weather.error.message}</PanelMessage>;
  if (!weather.data) return <PanelMessage>Loading weather…</PanelMessage>;
  const w: Weather = weather.data;
  if (w.time.length === 0) return <PanelMessage>No weather data for this session.</PanelMessage>;

  const rows: Row[] = [
    { label: 'Air', unit: '°C', values: w.air_temp, digits: 1 },
    { label: 'Track', unit: '°C', values: w.track_temp, digits: 1 },
    { label: 'Humidity', unit: '%', values: w.humidity, digits: 0 },
    { label: 'Pressure', unit: 'hPa', values: w.pressure, digits: 0 },
    { label: 'Wind', unit: 'm/s', values: w.wind_speed, digits: 1 },
  ];
  const refStart = marks[0]?.t ?? null;
  const rainFrom = w.rainfall.indexOf(true);
  const wind = meanDirection(w.wind_direction);

  return (
    <div className="h-full overflow-auto">
      <table className="w-full whitespace-nowrap text-[11px]">
        <thead>
          <tr>
            <th className={cn(th, 'text-left')}></th>
            <th className={cn(th, 'text-right')}>Start</th>
            <th className={cn(th, 'text-right')}>End</th>
            <th className={cn(th, 'text-right')}>Min</th>
            <th className={cn(th, 'text-right')}>Max</th>
            <th className={cn(th, 'text-right')} title="At the session clock">
              Clock
            </th>
            <th className={cn(th, 'text-left')}>Trend</th>
            <th className={cn(th, 'text-right')} title="When the reference lap started">
              Ref lap
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const f = (v: number) => v.toFixed(row.digits);
            return (
              <tr key={row.label}>
                <td className="px-1.5 py-[1px] text-left text-dim">
                  {row.label} <span className="text-faint">{row.unit}</span>
                </td>
                <td className={td}>{f(row.values[0])}</td>
                <td className={td}>{f(row.values[row.values.length - 1])}</td>
                <td className={cn(td, 'text-dim')}>{f(Math.min(...row.values))}</td>
                <td className={cn(td, 'text-dim')}>{f(Math.max(...row.values))}</td>
                <td className={td}>{f(interpolate(w.time, row.values, now))}</td>
                <td className="px-1.5 py-[1px]">
                  <Sparkline times={w.time} values={row.values} marks={marks} now={now} />
                </td>
                <td className={td}>
                  {refStart == null ? '' : f(interpolate(w.time, row.values, refStart))}
                </td>
              </tr>
            );
          })}
          <tr>
            <td className="px-1.5 py-[1px] text-left text-dim">Wind from</td>
            <td colSpan={7} className="px-1.5 text-left">
              {compass(wind)} <span className="text-faint">{wind}° on average</span>
            </td>
          </tr>
          <tr>
            <td className="px-1.5 py-[1px] text-left text-dim">Rain</td>
            <td colSpan={7} className={cn('px-1.5 text-left', rainFrom >= 0 && 'text-slow')}>
              {rainFrom < 0
                ? 'None'
                : `From ${Math.round((w.time[rainFrom] - w.time[0]) / 60)} min after the first reading`}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
