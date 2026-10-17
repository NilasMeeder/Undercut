import { useCallback, useMemo, useRef } from 'react';
import type { Circuit, DriverInfo } from '@/api/client';
import {
  useCircuit,
  useReplayPositions,
  useSessionDetail,
  type PositionTrack,
} from '@/api/queries';
import { COLORS } from '@/lib/colors';
import { carAt } from '@/lib/replay';
import { useGroupLaps, type GroupId } from '@/store/groups';
import { useClockDraw, useElementSize } from '../hooks';
import { PositionsMessage } from '../PositionsMessage';
import type { WidgetProps } from '../types';
import type { TrackLineConfig } from './widget';

const PAD = 24;
const LABEL_WIDTH = 24;
/** Label rows, nearest first, alternating above and below the line. */
const LANES = [-9, 17, -21, 29, -33, 41];

export function TrackLineWidget({ group, config }: WidgetProps<TrackLineConfig>) {
  const { status, track, error } = useReplayPositions();
  const detail = useSessionDetail();
  const circuit = useCircuit();
  if (!track || !detail.data) return <PositionsMessage status={status} error={error} />;
  return (
    <TrackLine
      group={group}
      track={track}
      drivers={detail.data.drivers}
      circuit={config.corners ? circuit.data : undefined}
    />
  );
}

function TrackLine({
  group,
  track,
  drivers,
  circuit,
}: {
  group: GroupId;
  track: PositionTrack;
  drivers: DriverInfo[];
  circuit: Circuit | undefined;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const carsRef = useRef<SVGGElement>(null);
  const emptyRef = useRef<SVGTextElement>(null);
  const { width, height } = useElementSize(boxRef);
  const selected = useGroupLaps(group);
  const highlight = useMemo(() => new Set(selected.map((l) => l.driver)), [selected]);
  const mid = Math.round(height / 2);
  const length = Math.max(width - 2 * PAD, 1);
  const color = (code: string) => drivers.find((d) => d.code === code)?.color ?? COLORS.textDim;

  const draw = useCallback(
    (t: number) => {
      const g = carsRef.current;
      if (!g || width === 0) return;
      const placed = track.cars
        .map((_, i) => {
          const at = carAt(track, i, t);
          return at ? { i, x: PAD + (at.progress % 1) * length } : null;
        })
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
    [track, width, length, mid]
  );
  useClockDraw(draw);

  return (
    <div ref={boxRef} className="h-full w-full overflow-hidden">
      <svg width={width} height={height} className="block">
        <line
          x1={PAD}
          x2={PAD + length}
          y1={mid}
          y2={mid}
          stroke={COLORS.lineStrong}
          strokeWidth={3}
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
