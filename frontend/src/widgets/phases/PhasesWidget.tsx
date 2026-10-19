import { useMemo } from 'react';
import type { ComparedLap } from '@/api/client';
import { LineSwatch, NoLapsMessage, PanelMessage } from '@/components/data/bits';
import { formatGap } from '@/lib/format';
import { diffCell, lengthOffNote, THRESHOLDS } from '@/lib/insights';
import { cornerPhases, type CornerPhases, type Phase } from '@/lib/phases';
import { td, th } from '@/lib/table';
import { cn } from '@/lib/utils';
import { cursorBus, useZoom } from '@/store/cursor';
import type { WidgetProps } from '../types';
import { useGroupComparison } from '../useGroupComparison';
import type { PhasesConfig } from './widget';

/** Strip height and gap per lap (px). */
const STRIP = 6;
const GAP = 2;
const OPACITY: Record<Phase, number> = { brake: 1, coast: 0.5, part: 0.22, full: 0 };

const lapName = (lap: ComparedLap, other: ComparedLap) =>
  lap.driver === other.driver ? `${lap.driver} L${lap.lap}` : lap.driver;

export function PhasesWidget({ group, config }: WidgetProps<PhasesConfig>) {
  const { laps, data, styles, error } = useGroupComparison(group);
  const zoom = useZoom(group);

  const rows = useMemo(() => {
    if (!data) return [];
    const built = data.corners.map((segment) => {
      const phases = data.laps.map((lap) =>
        cornerPhases(data.distance, lap.speed, lap.brake, lap.throttle, segment.start, segment.end)
      );
      const dt = segment.laps.length > 1 ? segment.laps[1].time - segment.laps[0].time : 0;
      return { segment, phases, dt, view: cornerView(phases, segment.start, segment.end) };
    });
    if (config.order === 'impact') built.sort((a, b) => Math.abs(b.dt) - Math.abs(a.dt));
    return built;
  }, [data, config.order]);

  if (laps.length === 0) return <NoLapsMessage group={group} />;
  if (error) return <PanelMessage>{error.message}</PanelMessage>;
  if (!data) return <PanelMessage>Loading…</PanelMessage>;
  if (data.corners.length === 0)
    return <PanelMessage>No corner data for this circuit.</PanelMessage>;
  const notes = data.laps
    .slice(0, 2)
    .map(lengthOffNote)
    .filter((n) => n != null);
  if (notes.length > 0)
    return (
      <div className="space-y-1 px-1.5 py-1 text-[11px] leading-snug text-dim">
        {notes.map((n) => (
          <p key={n}>{n}</p>
        ))}
      </div>
    );

  const [ref, lap] = [data.laps[0], data.laps[1]];
  const height = data.laps.length * (STRIP + GAP) - GAP;
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line px-1.5 py-0.5 text-[10px] text-dim">
        {data.laps.map((l, i) => (
          <span key={`${l.driver}-${l.lap}`} className="flex items-center gap-1">
            <LineSwatch color={styles[i]?.color ?? '#fff'} dash={styles[i]?.dash} />
            {l.driver} L{l.lap}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-2 text-faint">
          <Key opacity={1} label="brake" />
          <Key opacity={0.5} label="roll" />
          <Key opacity={0.22} label="part" />
          <span className="flex items-center gap-1">
            <span className="h-px w-3 bg-dim" />
            full
          </span>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full whitespace-nowrap text-[11px]">
          <thead>
            <tr>
              <th className={cn(th, 'text-left')}>Corner</th>
              <th className={cn(th, 'w-1/2 text-left')}>Phases</th>
              {lap ? (
                <>
                  <th className={cn(th, 'text-right')}>Δ s</th>
                  <th className={cn(th, 'text-right')} title="Where braking starts">
                    Brake
                  </th>
                  <th className={cn(th, 'text-right')} title="Metres on the brake">
                    Braking
                  </th>
                  <th className={cn(th, 'text-right')}>Apex</th>
                  <th className={cn(th, 'text-right')} title="Back on full throttle">
                    Full
                  </th>
                </>
              ) : (
                <>
                  <th className={cn(th, 'text-right')}>Braking</th>
                  <th className={cn(th, 'text-right')}>Apex</th>
                  <th className={cn(th, 'text-right')}>Roll</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ segment, phases, dt, view }) => {
              const zoomed = zoom != null && zoom[0] === segment.start && zoom[1] === segment.end;
              const [a, b] = [phases[0], phases[1]];
              return (
                <tr
                  key={segment.label}
                  onMouseEnter={() => a && cursorBus.setCursor(group, a.apex)}
                  onMouseLeave={() => cursorBus.setCursor(group, null)}
                  onClick={() =>
                    cursorBus.setZoom(group, zoomed ? null : [segment.start, segment.end])
                  }
                  className={cn('cursor-pointer hover:bg-raised', zoomed && 'bg-raised')}
                >
                  <td className="px-1.5 py-[2px] text-left align-middle font-semibold">
                    {segment.label}
                  </td>
                  <td className="min-w-[180px] px-1.5 py-[2px]">
                    <svg
                      viewBox={`${view[0]} 0 ${view[1] - view[0]} ${height}`}
                      preserveAspectRatio="none"
                      className="block w-full"
                      style={{ height }}
                      aria-label={`Phases through ${segment.label}`}
                    >
                      {phases.map((p, i) =>
                        p ? (
                          <Strip
                            key={i}
                            phases={p}
                            y={i * (STRIP + GAP)}
                            color={styles[i]?.color ?? '#fff'}
                            view={view}
                          />
                        ) : null
                      )}
                    </svg>
                  </td>
                  {lap && a && b ? (
                    <Compared a={a} b={b} dt={dt} />
                  ) : a ? (
                    <>
                      <td className={td}>{a.metres.brake.toFixed(0)} m</td>
                      <td className={td}>{a.minSpeed.toFixed(0)} km/h</td>
                      <td className={cn(td, 'text-dim')}>
                        {(a.metres.coast + a.metres.part).toFixed(0)} m
                      </td>
                    </>
                  ) : (
                    <td colSpan={5} />
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {lap ? (
          <p className="px-1.5 py-1 text-[10px] text-faint">
            {lapName(lap, ref)} against {lapName(ref, lap)}. Braking: metres on the brake (shorter =
            harder or later); edges ±10–20 m at ~4 Hz.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Key({ opacity, label }: { opacity: number; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-1.5 w-3 bg-dim" style={{ opacity }} />
      {label}
    </span>
  );
}

/** Metres shown around the corner itself, before the first brake and after full throttle. */
const MARGIN = 40;

/** The part of a segment the strips show: from the earliest brake point to the latest return
 * to full throttle (the straight after the corner is mostly full throttle and says little). */
function cornerView(phases: (CornerPhases | null)[], start: number, end: number): [number, number] {
  const known = phases.filter((p): p is CornerPhases => p != null);
  if (known.length === 0) return [start, end];
  const ons = known.map((p) => p.brakeOn ?? p.apex - 150);
  const fulls = known.map((p) => p.fullAt ?? p.apex + 150);
  return [Math.max(start, Math.min(...ons) - MARGIN), Math.min(end, Math.max(...fulls) + MARGIN)];
}

function Strip({
  phases,
  y,
  color,
  view,
}: {
  phases: CornerPhases;
  y: number;
  color: string;
  view: [number, number];
}) {
  const span = view[1] - view[0];
  return (
    <g>
      {/* Full throttle: a thin line through the strip. */}
      <rect
        x={view[0]}
        y={y + STRIP / 2 - 0.5}
        width={span}
        height={1}
        fill={color}
        opacity={0.6}
      />
      {phases.runs
        .filter((r) => OPACITY[r.phase] > 0)
        .map((r) => (
          <rect
            key={r.from}
            x={r.from}
            y={y}
            width={Math.max(r.to - r.from, span * 0.004)}
            height={STRIP}
            fill={color}
            opacity={OPACITY[r.phase]}
          />
        ))}
      <rect
        x={phases.apex - span * 0.004}
        y={y - 1}
        width={span * 0.008}
        height={STRIP + 2}
        fill="currentColor"
        className="text-text"
      />
    </g>
  );
}

function Compared({ a, b, dt }: { a: CornerPhases; b: CornerPhases; dt: number }) {
  const cells = [
    diffCell(
      a.brakeOn != null && b.brakeOn != null ? b.brakeOn - a.brakeOn : null,
      THRESHOLDS.brake,
      'm',
      'later',
      'earlier'
    ),
    diffCell(b.metres.brake - a.metres.brake, THRESHOLDS.brake, 'm', 'longer', 'shorter'),
    diffCell(b.minSpeed - a.minSpeed, THRESHOLDS.minSpeed, 'km/h', 'more', 'less'),
    diffCell(
      a.fullAt != null && b.fullAt != null ? b.fullAt - a.fullAt : null,
      THRESHOLDS.throttle,
      'm',
      'later',
      'earlier'
    ),
  ];
  const level = Math.abs(dt) < THRESHOLDS.level;
  return (
    <>
      <td className={cn(td, level && 'text-faint')}>{formatGap(dt)}</td>
      {cells.map((c, i) => (
        <td key={i} className={cn(td, c.faint ? 'text-faint' : 'text-text')}>
          {c.text}
        </td>
      ))}
    </>
  );
}
