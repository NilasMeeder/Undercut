import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Circuit, Comparison, DriverInfo } from '@/api/client';
import {
  useCircuit,
  useReplayPositions,
  useSessionDetail,
  type PositionTrack,
} from '@/api/queries';
import { PanelMessage } from '@/components/data/bits';
import { COLORS } from '@/lib/colors';
import { carAt } from '@/lib/replay';
import type { LapStyle } from '@/lib/timing';
import { cursorBus, useZoom } from '@/store/cursor';
import { useGroupLaps, type GroupId } from '@/store/groups';
import { useClockDraw } from '../hooks';
import type { WidgetProps } from '../types';
import { useGroupComparison } from '../useGroupComparison';
import type { TrackMapConfig } from './widget';

type Point = [number, number];

/** Rotate by the circuit's official orientation; SVG y points down, so flip it. */
function project(x: number, y: number, rotation: number): Point {
  const a = (rotation * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), -(x * Math.sin(a) + y * Math.cos(a))];
}

function indexAt(distance: number[], d: number): number {
  let lo = 0;
  let hi = distance.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (distance[mid] < d) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function toPath(points: Point[]): string {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(0)},${y.toFixed(0)}`).join('');
}

export function TrackMapWidget({ group, config }: WidgetProps<TrackMapConfig>) {
  const circuit = useCircuit();
  const { data, styles } = useGroupComparison(group, { miniSectors: config.miniSectors });

  if (circuit.error) return <PanelMessage>{circuit.error.message}</PanelMessage>;
  if (!circuit.data) return <PanelMessage>Loading circuit…</PanelMessage>;
  if (config.cars === 'all')
    return <ReplayMap group={group} circuit={circuit.data} showCorners={config.corners} />;
  return (
    <TrackMap
      group={group}
      circuit={circuit.data}
      comparison={data}
      styles={styles}
      showCorners={config.corners}
    />
  );
}

/** Every car at the session clock. */
function ReplayMap({
  group,
  circuit,
  showCorners,
}: {
  group: GroupId;
  circuit: Circuit;
  showCorners: boolean;
}) {
  const { status, track, error } = useReplayPositions();
  const detail = useSessionDetail();
  const loading =
    error?.message ??
    (status?.state === 'error'
      ? `Positions failed: ${status.error}`
      : track
        ? null
        : `${status?.phase ?? 'Preparing positions'}… ${Math.round((status?.progress ?? 0) * 100)}%`);
  return (
    <TrackMap
      group={group}
      circuit={circuit}
      comparison={undefined}
      styles={[]}
      showCorners={showCorners}
      note={loading}
      cars={track && detail.data ? { track, drivers: detail.data.drivers } : undefined}
    />
  );
}

function TrackMap({
  group,
  circuit,
  comparison,
  styles,
  showCorners,
  note,
  cars,
}: {
  group: GroupId;
  circuit: Circuit;
  comparison: Comparison | undefined;
  styles: LapStyle[];
  showCorners: boolean;
  note?: string | null;
  cars?: { track: PositionTrack; drivers: DriverInfo[] };
}) {
  const zoom = useZoom(group);
  const dotsRef = useRef<SVGGElement>(null);
  const carsRef = useRef<SVGGElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  const selected = useGroupLaps(group);
  const highlight = useMemo(() => new Set(selected.map((l) => l.driver)), [selected]);

  const geometry = useMemo(() => {
    const outline = circuit.track_x.map((x, i) => project(x, circuit.track_y[i], circuit.rotation));
    const xs = outline.map((p) => p[0]);
    const ys = outline.map((p) => p[1]);
    const [minX, maxX, minY, maxY] = [
      Math.min(...xs),
      Math.max(...xs),
      Math.min(...ys),
      Math.max(...ys),
    ];
    const size = Math.max(maxX - minX, maxY - minY);
    const pad = size * 0.08;
    return {
      outline: toPath(outline) + 'Z',
      viewBox: `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`,
      unit: size / 100,
      corners: circuit.corners.map((c) => {
        const [x, y] = project(c.x, c.y, circuit.rotation);
        const [ox, oy] = project(
          Math.cos((c.angle * Math.PI) / 180) * size * 0.045,
          Math.sin((c.angle * Math.PI) / 180) * size * 0.045,
          circuit.rotation
        );
        return { label: c.label, x: x + ox, y: y + oy };
      }),
    };
  }, [circuit]);

  // Reference lap path on the comparison grid, split per mini-sector and coloured by the fastest lap.
  const lap = useMemo(() => {
    if (!comparison || comparison.laps.length === 0) return null;
    const ref = comparison.laps[0];
    const points = ref.x.map((x, i) => project(x, ref.y[i], circuit.rotation));
    const { boundaries, fastest } = comparison.mini_sectors;
    const sectors = fastest.map((winner, s) => {
      const from = indexAt(comparison.distance, boundaries[s]);
      const to = indexAt(comparison.distance, boundaries[s + 1]);
      return {
        d: toPath(points.slice(from, to + 1)),
        color: styles[winner]?.color ?? COLORS.textDim,
      };
    });
    const zoomed =
      zoom &&
      toPath(
        points.slice(
          indexAt(comparison.distance, zoom[0]),
          indexAt(comparison.distance, zoom[1]) + 1
        )
      );
    return {
      sectors,
      zoomed,
      laps: comparison.laps.map((l) => l.x.map((x, i) => project(x, l.y[i], circuit.rotation))),
    };
  }, [comparison, styles, circuit.rotation, zoom]);

  // Cursor dots move imperatively: no React render per mouse move.
  useEffect(() => {
    if (!comparison || !lap) return;
    const update = () => {
      const g = dotsRef.current;
      if (!g) return;
      const distance = cursorBus.getCursor(group);
      const i = distance == null ? null : indexAt(comparison.distance, distance);
      Array.from(g.children).forEach((dot, n) => {
        const point = i == null ? null : lap.laps[n]?.[i];
        dot.setAttribute('visibility', point ? 'visible' : 'hidden');
        if (point) dot.setAttribute('transform', `translate(${point[0]},${point[1]})`);
      });
    };
    update();
    return cursorBus.subscribeCursor(group, update);
  }, [comparison, lap, group]);

  // Every car at the session clock, moved imperatively on each tick.
  const drawCars = useCallback(
    (t: number) => {
      const g = carsRef.current;
      if (!g || !cars) return;
      let shown = 0;
      Array.from(g.children).forEach((node, i) => {
        const at = carAt(cars.track, i, t);
        node.setAttribute('visibility', at ? 'visible' : 'hidden');
        if (!at) return;
        shown++;
        const [x, y] = project(at.x, at.y, circuit.rotation);
        node.setAttribute('transform', `translate(${x.toFixed(0)},${y.toFixed(0)})`);
      });
      if (emptyRef.current) emptyRef.current.hidden = shown > 0;
    },
    [cars, circuit.rotation]
  );
  useClockDraw(cars ? drawCars : null);

  const u = geometry.unit;
  const color = (code: string) =>
    cars?.drivers.find((d) => d.code === code)?.color ?? COLORS.textDim;
  return (
    <div className="relative h-full">
      {lap || note ? (
        <div className="absolute left-1.5 top-1 z-10 text-[10px] text-faint">
          {note ?? 'Mini-sectors: fastest lap colours the track'}
        </div>
      ) : null}
      {cars ? (
        <div ref={emptyRef} hidden className="absolute left-1.5 top-1 z-10 text-[10px] text-faint">
          No cars on track at the session clock
        </div>
      ) : null}
      <svg viewBox={geometry.viewBox} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        <path
          d={geometry.outline}
          fill="none"
          stroke={COLORS.lineStrong}
          strokeWidth={u * 2.2}
          strokeLinejoin="round"
        />
        {lap?.sectors.map((s, i) => (
          <path
            key={i}
            d={s.d}
            fill="none"
            stroke={s.color}
            strokeWidth={u * 0.9}
            strokeLinecap="round"
            opacity={lap.zoomed ? 0.35 : 1}
          />
        ))}
        {lap?.zoomed ? (
          <path
            d={lap.zoomed}
            fill="none"
            stroke={COLORS.text}
            strokeWidth={u * 1.1}
            strokeLinecap="round"
          />
        ) : null}
        {(showCorners ? geometry.corners : []).map((c) => (
          <text
            key={c.label}
            x={c.x}
            y={c.y}
            fill={COLORS.textFaint}
            fontSize={u * 2.6}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {c.label}
          </text>
        ))}
        <g ref={carsRef}>
          {cars?.track.cars.map((car) => {
            const strong = highlight.has(car.driver);
            return (
              <g key={car.driver} visibility="hidden">
                <circle
                  r={u * (strong ? 1.6 : 1.3)}
                  fill={color(car.driver)}
                  stroke={strong ? COLORS.text : COLORS.bg}
                  strokeWidth={u * 0.4}
                />
                <text
                  x={u * 2}
                  fill={strong ? COLORS.text : COLORS.textDim}
                  fontSize={u * 2.4}
                  fontWeight={strong ? 700 : 500}
                  dominantBaseline="central"
                >
                  {car.driver}
                </text>
              </g>
            );
          })}
        </g>
        <g ref={dotsRef}>
          {styles.map((s, n) => (
            <circle
              key={n}
              r={u * 1.4}
              fill={s.color}
              stroke={COLORS.bg}
              strokeWidth={u * 0.4}
              visibility="hidden"
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
