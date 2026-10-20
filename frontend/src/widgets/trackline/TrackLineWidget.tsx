import { useCallback, useMemo, useRef } from 'react';
import type { Circuit, DriverInfo } from '@/api/client';
import {
  useCircuit,
  useReplayPositions,
  useSessionDetail,
  type PositionTrack,
} from '@/api/queries';
import { useDistanceMarks } from '@/api/markers';
import { isAuto } from '@/lib/autoMarkers';
import { COLORS } from '@/lib/colors';
import { carAt, ghostKinds, pitGhost, type GhostKind } from '@/lib/replay';
import { useGroupLaps, type GroupId } from '@/store/groups';
import { useClockDraw, useElementSize } from '../hooks';
import { PositionsMessage } from '../PositionsMessage';
import { useSectorFlags } from '../useSectorFlags';
import type { WidgetProps } from '../types';
import type { TrackLineConfig } from './widget';

const PAD = 24;
const LABEL_WIDTH = 24;
/** Label rows, nearest first, alternating above and below the line. */
const LANES = [-9, 17, -21, 29, -33, 41];
const NO_GHOSTS: GhostKind[] = [];

export function TrackLineWidget({ group, config }: WidgetProps<TrackLineConfig>) {
  const { status, track, error } = useReplayPositions();
  const detail = useSessionDetail();
  const circuit = useCircuit();
  const ghosts = useMemo(
    () => (config.ghosts ? ghostKinds(circuit.data) : NO_GHOSTS),
    [config.ghosts, circuit.data]
  );
  if (!track || !detail.data) return <PositionsMessage status={status} error={error} />;
  return (
    <TrackLine
      group={group}
      track={track}
      drivers={detail.data.drivers}
      circuit={config.corners ? circuit.data : undefined}
      showMarks={config.markers}
      ghosts={ghosts}
    />
  );
}

function TrackLine({
  group,
  track,
  drivers,
  circuit,
  showMarks,
  ghosts,
}: {
  group: GroupId;
  track: PositionTrack;
  drivers: DriverInfo[];
  circuit: Circuit | undefined;
  showMarks: boolean;
  ghosts: GhostKind[];
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const ghostsRef = useRef<SVGGElement>(null);
  const carsRef = useRef<SVGGElement>(null);
  const emptyRef = useRef<SVGTextElement>(null);
  const { width, height } = useElementSize(boxRef);
  const selected = useGroupLaps(group);
  const highlight = useMemo(() => new Set(selected.map((l) => l.driver)), [selected]);
  const mid = Math.round(height / 2);
  const length = Math.max(width - 2 * PAD, 1);
  const marks = useDistanceMarks(group);
  // Labels that would overlap go a row down (~5 px per character at 9 px). An automatic one is
  // only its band (its note on hover), as on the map with all cars.
  const markRows = useMemo(() => {
    const ends = [-Infinity, -Infinity, -Infinity];
    return (showMarks ? marks : []).map((mark) => {
      if (isAuto(mark)) return { mark, row: null };
      const x = PAD + (mark.start / track.lapLength) * length;
      const free = ends.findIndex((end) => end < x);
      const row = free < 0 ? 0 : free;
      ends[row] = x + 6 + Math.min(mark.label.length, 24) * 5;
      return { mark, row };
    });
  }, [marks, showMarks, track.lapLength, length]);
  const color = (code: string) => drivers.find((d) => d.code === code)?.color ?? COLORS.textDim;

  const draw = useCallback(
    (t: number) => {
      const g = carsRef.current;
      if (!g || width === 0) return;
      const now = track.cars.map((_, i) => carAt(track, i, t));
      Array.from(ghostsRef.current?.children ?? []).forEach((node) => {
        const i = Number(node.getAttribute('data-car'));
        const ghost = pitGhost(track, i, t, Number(node.getAttribute('data-loss')), now);
        node.setAttribute('visibility', ghost ? 'visible' : 'hidden');
        if (!ghost) return;
        node.setAttribute(
          'transform',
          `translate(${(PAD + (ghost.progress % 1) * length).toFixed(1)},${mid})`
        );
        node.lastElementChild!.textContent = `${node.getAttribute('data-label')} P${ghost.position}`;
      });
      const placed = now
        .map((at, i) => (at ? { i, x: PAD + (at.progress % 1) * length } : null))
        .filter((c) => c != null)
        .sort((a, b) => a.x - b.x);
      emptyRef.current?.setAttribute('visibility', placed.length ? 'hidden' : 'visible');
      const lanes = new Map<number, number>();
      const laneEnd = LANES.map(() => -Infinity);
      for (const car of placed) {
        let lane = laneEnd.findIndex((end) => end < car.x - LABEL_WIDTH / 2);
        if (lane < 0) lane = 0;
        laneEnd[lane] = car.x + LABEL_WIDTH / 2;
        lanes.set(car.i, lane);
      }
      Array.from(g.children).forEach((node, i) => {
        const car = placed.find((c) => c.i === i);
        node.setAttribute('visibility', car ? 'visible' : 'hidden');
        if (!car) return;
        node.setAttribute('transform', `translate(${car.x.toFixed(1)},${mid})`);
        const offset = LANES[lanes.get(i) ?? 0];
        const [tick, , label] = Array.from(node.children);
        tick.setAttribute('y2', String(offset < 0 ? offset + 6 : offset - 10));
        label.setAttribute('y', String(offset));
      });
    },
    // Ghost nodes change with the selection: redraw them at once, also with the clock paused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [track, width, length, mid, highlight, ghosts]
  );
  useClockDraw(draw);

  return (
    <div ref={boxRef} className="h-full w-full overflow-hidden">
      <svg width={width} height={height} className="block">
        {markRows.map(({ mark: m, row }) => {
          const x0 = PAD + (m.start / track.lapLength) * length;
          const x1 = m.end == null ? x0 : PAD + (m.end / track.lapLength) * length;
          return (
            <g key={m.id} opacity={m.dim ? 0.45 : 1}>
              <title>{m.label}</title>
              {m.end != null ? (
                <rect x={x0} y={0} width={x1 - x0} height={height} fill={COLORS.markerFill} />
              ) : null}
              {(m.end == null ? [x0] : [x0, x1]).map((x) => (
                <line
                  key={x}
                  x1={x}
                  x2={x}
                  y1={0}
                  y2={height}
                  stroke={COLORS.textFaint}
                  strokeDasharray="3 3"
                />
              ))}
              {row == null ? null : (
                <text x={x0 + 3} y={10 + row * 11} fill={COLORS.textDim} fontSize={9}>
                  {m.label.length > 24 ? `${m.label.slice(0, 23)}…` : m.label}
                </text>
              )}
            </g>
          );
        })}
        <line
          x1={PAD}
          x2={PAD + length}
          y1={mid}
          y2={mid}
          stroke={COLORS.lineStrong}
          strokeWidth={3}
        />
        <SectorFlags
          lapLength={track.lapLength}
          x={(d) => PAD + (d / track.lapLength) * length}
          y={mid}
        />
        {[PAD, PAD + length].map((x) => (
          <line key={x} x1={x} x2={x} y1={mid - 8} y2={mid + 8} stroke={COLORS.textDim} />
        ))}
        <text x={PAD} y={mid - 12} fill={COLORS.textFaint} fontSize={9} textAnchor="middle">
          S/F
        </text>
        <text
          ref={emptyRef}
          x={PAD + length / 2}
          y={mid - 12}
          fill={COLORS.textFaint}
          fontSize={10}
          textAnchor="middle"
          visibility="hidden"
        >
          No cars on track at the session clock
        </text>
        {circuit?.corners.map((c) => {
          const x = PAD + (c.distance / track.lapLength) * length;
          return (
            <g key={c.label}>
              <line x1={x} x2={x} y1={mid - 3} y2={mid + 3} stroke={COLORS.textFaint} />
              <text x={x} y={height - 4} fill={COLORS.textFaint} fontSize={9} textAnchor="middle">
                {c.label}
              </text>
            </g>
          );
        })}
        <g ref={ghostsRef}>
          {track.cars.flatMap((car, i) =>
            highlight.has(car.driver)
              ? ghosts.map((kind) => (
                  <g
                    key={`${car.driver}-${kind.label}`}
                    data-car={i}
                    data-loss={kind.loss}
                    data-label={`${car.driver} ${kind.label}`}
                    visibility="hidden"
                  >
                    <title>{`${car.driver} after a pit stop now (${kind.loss.toFixed(1)} s lost)`}</title>
                    <line y1={-6} y2={6} stroke={color(car.driver)} strokeWidth={2} />
                    <rect
                      x={-4}
                      y={-4}
                      width={8}
                      height={8}
                      fill="none"
                      stroke={color(car.driver)}
                      strokeWidth={1.5}
                      strokeDasharray={kind.label === 'SC' ? '2 2' : undefined}
                    />
                    <text
                      y={kind.label === 'SC' ? 32 : 22}
                      fill={COLORS.textDim}
                      fontSize={9}
                      textAnchor="middle"
                    />
                  </g>
                ))
              : []
          )}
        </g>
        <g ref={carsRef}>
          {track.cars.map((car) => {
            const strong = highlight.has(car.driver);
            return (
              <g key={car.driver} visibility="hidden">
                <line y1={0} y2={0} stroke={COLORS.lineStrong} />
                <circle
                  r={strong ? 5 : 4}
                  fill={color(car.driver)}
                  stroke={strong ? COLORS.text : COLORS.bg}
                  strokeWidth={1.5}
                />
                <text
                  fill={strong ? COLORS.text : COLORS.textDim}
                  fontSize={10}
                  fontWeight={strong ? 700 : 500}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {car.driver}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

/** Yellow flags at the session clock: the marshal sector in yellow on the line. */
function SectorFlags({
  lapLength,
  x,
  y,
}: {
  lapLength: number;
  x: (distance: number) => number;
  y: number;
}) {
  const flags = useSectorFlags(lapLength);
  return (
    <>
      {flags.flatMap((f) =>
        f.ranges.map(([start, end]) => (
          <line
            key={`${f.sector}-${start}`}
            x1={x(start)}
            x2={x(end)}
            y1={y}
            y2={y}
            stroke={COLORS.slow}
            strokeWidth={f.double ? 6 : 4}
          >
            <title>{`${f.double ? 'Double yellow' : 'Yellow'} in sector ${f.sector}`}</title>
          </line>
        ))
      )}
    </>
  );
}
