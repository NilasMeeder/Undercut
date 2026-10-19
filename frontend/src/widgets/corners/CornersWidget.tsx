import { useMemo, useState } from 'react';
import type { ComparedLap, CornerLap, CornerSegment } from '@/api/client';
import { NoLapsMessage, PanelMessage } from '@/components/data/bits';
import { formatGap } from '@/lib/format';
import { diffCell, explainCorner, lengthOffNote, THRESHOLDS } from '@/lib/insights';
import { td, th } from '@/lib/table';
import type { LapStyle } from '@/lib/timing';
import { cn } from '@/lib/utils';
import { cursorBus, useZoom } from '@/store/cursor';
import type { GroupId } from '@/store/groups';
import type { WidgetProps } from '../types';
import { useGroupComparison } from '../useGroupComparison';
import type { CornersConfig } from './widget';

/** "VER" when the drivers differ, "VER L12" when comparing two laps of one driver. */
function names(ref: ComparedLap, lap: ComparedLap): [string, string] {
  return ref.driver === lap.driver
    ? [`${ref.driver} L${ref.lap}`, `${lap.driver} L${lap.lap}`]
    : [ref.driver, lap.driver];
}

export function CornersWidget({ group, config }: WidgetProps<CornersConfig>) {
  const { laps, data, styles, error } = useGroupComparison(group);
  const [picked, setPicked] = useState(1);

  if (laps.length === 0) return <NoLapsMessage group={group} />;
  if (laps.length === 1)
    return <PanelMessage>Select a second lap to compare corners.</PanelMessage>;
  if (error) return <PanelMessage>{error.message}</PanelMessage>;
  if (!data) return <PanelMessage>Loading…</PanelMessage>;
  if (data.corners.length === 0)
    return <PanelMessage>No corner data for this circuit.</PanelMessage>;

  const index = Math.min(picked, data.laps.length - 1);
  const notes = [data.laps[0], data.laps[index]].map(lengthOffNote).filter((n) => n != null);
  return (
    <div className="flex h-full flex-col">
      {data.laps.length > 2 ? (
        <div className="flex shrink-0 items-center gap-0.5 border-b border-line px-1 py-0.5">
          {data.laps.slice(1).map((lap, i) => (
            <button
              key={`${lap.driver}-${lap.lap}`}
              type="button"
              onClick={() => setPicked(i + 1)}
              className={cn(
                'px-1.5 py-0.5 text-[10px] font-semibold',
                index === i + 1 ? 'bg-raised text-text' : 'text-faint hover:text-dim'
              )}
            >
              {lap.driver} L{lap.lap}
            </button>
          ))}
          <span className="ml-auto pr-1 text-[10px] text-faint">
            vs {data.laps[0].driver} L{data.laps[0].lap}
          </span>
        </div>
      ) : null}
      {notes.length > 0 ? (
        <div className="space-y-1 px-1.5 py-1 text-[11px] leading-snug text-dim">
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      ) : (
        <CornerTable
          group={group}
          corners={data.corners}
          reference={data.laps[0]}
          lap={data.laps[index]}
          index={index}
          styles={styles}
          config={config}
        />
      )}
    </div>
  );
}

function CornerTable({
  group,
  corners,
  reference,
  lap,
  index,
  styles,
  config,
}: {
  group: GroupId;
  corners: CornerSegment[];
  reference: ComparedLap;
  lap: ComparedLap;
  index: number;
  styles: LapStyle[];
  config: CornersConfig;
}) {
  const zoom = useZoom(group);
  const [refName, name] = names(reference, lap);

  const rows = useMemo(() => {
    const built = corners.map((segment) => {
      const a: CornerLap = segment.laps[0];
      const b: CornerLap = segment.laps[index];
      return { segment, a, b, dt: b.time - a.time };
    });
    if (config.order === 'impact') built.sort((x, y) => Math.abs(y.dt) - Math.abs(x.dt));
    return built;
  }, [corners, index, config.order]);

  const insights = useMemo(
    () =>
      [...rows]
        .sort((x, y) => Math.abs(y.dt) - Math.abs(x.dt))
        .slice(0, config.insights)
        .filter((r) => Math.abs(r.dt) >= THRESHOLDS.level)
        .map((r) => explainCorner(name, refName, r.segment.label, r.a, r.b)),
    [rows, config.insights, name, refName]
  );

  const scale = Math.max(...rows.map((r) => Math.abs(r.dt)), 0.001);
  // The lap delta at the line, not the sum of rounded segment times.
  const total = lap.delta.at(-1) ?? rows.reduce((sum, r) => sum + r.dt, 0);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {insights.length > 0 ? (
        <ul className="space-y-0.5 border-b border-line px-1.5 py-1 text-[11px] leading-snug text-dim">
          {insights.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      <table className="w-full whitespace-nowrap text-[11px]">
        <thead>
          <tr>
            <th className={cn(th, 'text-left')}>Corner</th>
            <th className={cn(th, 'text-center')} title={`${name} vs ${refName}`}>
              {refName} faster · {name} faster
            </th>
            <th className={cn(th, 'text-right')}>Δ s</th>
            <th className={cn(th, 'text-right')}>Brake</th>
            <th className={cn(th, 'text-right')}>Min speed</th>
            <th className={cn(th, 'text-right')}>Full throttle</th>
            <th className={cn(th, 'text-right')}>Top speed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ segment, a, b, dt }) => {
            const zoomed = zoom != null && zoom[0] === segment.start && zoom[1] === segment.end;
            const brake = diffCell(
              a.brake_at != null && b.brake_at != null ? b.brake_at - a.brake_at : null,
              THRESHOLDS.brake,
              'm',
              'later',
              'earlier'
            );
            const min = diffCell(
              b.min_speed - a.min_speed,
              THRESHOLDS.minSpeed,
              'km/h',
              'more',
              'less'
            );
            const throttle = diffCell(
              a.throttle_at != null && b.throttle_at != null ? b.throttle_at - a.throttle_at : null,
              THRESHOLDS.throttle,
              'm',
              'later',
              'earlier'
            );
            const top = diffCell(
              b.top_speed - a.top_speed,
              THRESHOLDS.topSpeed,
              'km/h',
              'more',
              'less'
            );
            const width = `${(Math.abs(dt) / scale) * 50}%`;
            const level = Math.abs(dt) < THRESHOLDS.level;
            return (
              <tr
                key={segment.label}
                onMouseEnter={() => cursorBus.setCursor(group, a.min_speed_at)}
                onMouseLeave={() => cursorBus.setCursor(group, null)}
                onClick={() =>
                  cursorBus.setZoom(group, zoomed ? null : [segment.start, segment.end])
                }
                className={cn('cursor-pointer hover:bg-raised', zoomed && 'bg-raised')}
              >
                <td className="px-1.5 py-[1px] text-left font-semibold">{segment.label}</td>
                <td className="w-40 px-1.5">
                  <div className="relative h-2.5">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
                    {level ? null : (
                      <div
                        className="absolute inset-y-0"
                        style={{
                          width,
                          background: (dt > 0 ? styles[0] : styles[index])?.color,
                          ...(dt > 0 ? { right: '50%' } : { left: '50%' }),
                        }}
                      />
                    )}
                  </div>
                </td>
                <td className={cn(td, level && 'text-faint')}>{formatGap(dt)}</td>
                <td className={cn(td, brake.faint ? 'text-faint' : 'text-text')}>{brake.text}</td>
                <td className={cn(td, min.faint ? 'text-faint' : 'text-text')}>{min.text}</td>
                <td className={cn(td, throttle.faint ? 'text-faint' : 'text-text')}>
                  {throttle.text}
                </td>
                <td className={cn(td, top.faint ? 'text-faint' : 'text-text')}>{top.text}</td>
              </tr>
            );
          })}
          <tr className="border-t border-line">
            <td className="px-1.5 py-[1px] text-left text-[10px] uppercase text-faint">Lap</td>
            <td />
            <td className={cn(td, 'font-semibold')}>{formatGap(total)}</td>
            <td colSpan={4} className="px-1.5 text-left text-[10px] text-faint">
              {name} vs {refName}; + = {name} slower
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
