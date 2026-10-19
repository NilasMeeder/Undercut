import { useState } from 'react';
import type { CornerLap, CornersProgress } from '@/api/client';
import { useCornersProgress, useSessionDetail, useTimeline } from '@/api/queries';
import { NoLapsMessage, PanelMessage } from '@/components/data/bits';
import { COLORS } from '@/lib/colors';
import { formatGap, formatLapTime } from '@/lib/format';
import { diffCell, explainCorner, THRESHOLDS } from '@/lib/insights';
import { td, th } from '@/lib/table';
import { cn } from '@/lib/utils';
import { useClockTime } from '@/store/clock';
import { cursorBus, useZoom } from '@/store/cursor';
import { useGroupLaps } from '@/store/groups';
import type { WidgetProps } from '../types';
import type { LiveCornersConfig } from './widget';

/**
 * The corners of the lap in progress (backend: /corners-progress). Until the car is through the
 * first corner of a new lap, the lap that just finished (asked at its end), so a whole lap stays
 * readable after the line.
 */
function useLiveCorners(driver: string | undefined, against: LiveCornersConfig['reference']) {
  const t = useClockTime(500);
  const race = useTimeline().data?.kind === 'race';
  const reference = against === 'auto' ? (race ? 'previous' : 'best') : against;
  const now = useCornersProgress(driver, t, reference);
  const latest = now.data?.driver === driver ? now.data : undefined;
  const fresh = latest != null && latest.corners.every((c) => c.current == null);
  const finished = useCornersProgress(
    fresh ? driver : undefined,
    (latest?.start ?? 0) - 0.001,
    reference,
    true
  ).data;
  // While that loads, whatever was on screen if it is that lap.
  const [shown, setShown] = useState<CornersProgress | undefined>(undefined);
  const previous = (p: CornersProgress | undefined) =>
    p != null && fresh && p.driver === driver && p.lap === latest.lap - 1;
  const data = previous(finished) ? finished : previous(shown) ? shown : latest;
  if (data !== shown) setShown(data);
  return { data, error: now.error, holding: data != null && data !== latest };
}

export function LiveCornersWidget({ group, config }: WidgetProps<LiveCornersConfig>) {
  const laps = useGroupLaps(group);
  const driver = laps[0]?.driver;
  const { data, error, holding } = useLiveCorners(driver, config.reference);
  const zoom = useZoom(group);
  const color =
    useSessionDetail().data?.drivers.find((d) => d.code === driver)?.color ?? COLORS.text;

  if (!driver) return <NoLapsMessage group={group} />;
  if (error && !data) return <PanelMessage>{error.message}</PanelMessage>;
  if (!data) return <PanelMessage>Loading…</PanelMessage>;
  if (data.reference_lap == null)
    return <PanelMessage>No finished lap of {driver} to compare with yet.</PanelMessage>;
  if (data.corners.length === 0)
    return <PanelMessage>No corner data for this circuit.</PanelMessage>;

  const done = data.corners.filter((c) => c.current != null);
  const dt = (c: { reference: CornerLap; current: CornerLap | null }) =>
    c.current ? c.current.time - c.reference.time : 0;
  const scale = Math.max(...done.map((c) => Math.abs(dt(c))), 0.001);
  const total = done.reduce((sum, c) => sum + dt(c), 0);
  const last = done.at(-1);
  const name = `${driver} L${data.lap}`;
  const refName = `L${data.reference_lap}`;
  const insight =
    last && last.current && !data.out_lap
      ? explainCorner(name, refName, last.label, last.reference, last.current)
      : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 px-1.5 py-0.5 text-[11px] tabular-nums">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-[3px]" style={{ background: color }} />
          <span className="font-semibold">{driver}</span>
          <span className="text-dim">LAP {data.lap}</span>
        </span>
        {holding ? <span className="text-[10px] font-semibold text-faint">FINISHED</span> : null}
        {data.out_lap ? (
          <span className="text-[10px] font-semibold text-faint">OUT LAP</span>
        ) : null}
        <span className="ml-auto text-faint">
          vs {refName} {formatLapTime(data.reference_time)}
        </span>
      </div>
      {insight ? (
        <p className="shrink-0 border-y border-line px-1.5 py-0.5 text-[11px] leading-snug text-dim">
          {insight}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full whitespace-nowrap text-[11px]">
          <thead>
            <tr>
              <th className={cn(th, 'text-left')}>Corner</th>
              <th className={cn(th, 'text-center')}>{refName} faster · this lap faster</th>
              <th className={cn(th, 'text-right')}>Δ s</th>
              <th className={cn(th, 'text-right')}>Brake</th>
              <th className={cn(th, 'text-right')}>Min speed</th>
              <th className={cn(th, 'text-right')}>Full throttle</th>
              <th className={cn(th, 'text-right')}>Top speed</th>
            </tr>
          </thead>
          <tbody>
            {data.corners.map((c) => {
              const a = c.reference;
              const b = c.current;
              const zoomed = zoom != null && zoom[0] === c.start && zoom[1] === c.end;
              const d = dt(c);
              const level = Math.abs(d) < THRESHOLDS.level;
              const cells = b
                ? [
                    diffCell(
                      a.brake_at != null && b.brake_at != null ? b.brake_at - a.brake_at : null,
                      THRESHOLDS.brake,
                      'm',
                      'later',
                      'earlier'
                    ),
                    diffCell(
                      b.min_speed - a.min_speed,
                      THRESHOLDS.minSpeed,
                      'km/h',
                      'more',
                      'less'
                    ),
                    diffCell(
                      a.throttle_at != null && b.throttle_at != null
                        ? b.throttle_at - a.throttle_at
                        : null,
                      THRESHOLDS.throttle,
                      'm',
                      'later',
                      'earlier'
                    ),
                    diffCell(
                      b.top_speed - a.top_speed,
                      THRESHOLDS.topSpeed,
                      'km/h',
                      'more',
                      'less'
                    ),
                  ]
                : [];
              return (
                <tr
                  key={c.label}
                  onMouseEnter={() => cursorBus.setCursor(group, a.min_speed_at)}
                  onMouseLeave={() => cursorBus.setCursor(group, null)}
                  onClick={() => cursorBus.setZoom(group, zoomed ? null : [c.start, c.end])}
                  className={cn(
                    'cursor-pointer hover:bg-raised',
                    zoomed && 'bg-raised',
                    c === last && 'bg-header'
                  )}
                >
                  <td className={cn('px-1.5 py-[1px] text-left font-semibold', !b && 'text-faint')}>
                    {c.label}
                  </td>
                  <td className="w-40 px-1.5">
                    <div className="relative h-2.5">
                      <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
                      {!b || level ? null : (
                        <div
                          className="absolute inset-y-0"
                          style={{
                            width: `${(Math.abs(d) / scale) * 50}%`,
                            background: d > 0 ? COLORS.slow : COLORS.pb,
                            ...(d > 0 ? { right: '50%' } : { left: '50%' }),
                          }}
                        />
                      )}
                    </div>
                  </td>
                  <td className={cn(td, (!b || level) && 'text-faint')}>{b ? formatGap(d) : ''}</td>
                  {b ? (
                    cells.map((cell, i) => (
                      <td key={i} className={cn(td, cell.faint ? 'text-faint' : 'text-text')}>
                        {cell.text}
                      </td>
                    ))
                  ) : (
                    <td colSpan={4} className={cn(td, 'text-faint')}>
                      {formatLapTime(a.time).replace(/^0:/, '')} on {refName}
                    </td>
                  )}
                </tr>
              );
            })}
            <tr className="border-t border-line">
              <td className="px-1.5 py-[1px] text-left text-[10px] uppercase text-faint">Lap</td>
              <td />
              <td className={cn(td, 'font-semibold')}>{done.length ? formatGap(total) : ''}</td>
              <td colSpan={4} className="px-1.5 text-left text-[10px] text-faint">
                {done.length} of {data.corners.length} corners; + = this lap slower
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
