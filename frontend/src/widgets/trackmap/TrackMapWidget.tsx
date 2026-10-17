import { useEffect, useMemo, useRef } from 'react';
import type { Circuit, Comparison } from '@/api/client';
import { useCircuit } from '@/api/queries';
import { PanelMessage } from '@/components/data/bits';
import { COLORS } from '@/lib/colors';
import type { LapStyle } from '@/lib/timing';
import { cursorBus, useZoom } from '@/store/cursor';
import type { WidgetProps } from '../types';
import { useGroupComparison } from '../useGroupComparison';

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

export function TrackMapWidget({ group }: WidgetProps) {
  const circuit = useCircuit();
  const { data, styles } = useGroupComparison(group);

  if (circuit.error) return <PanelMessage>{circuit.error.message}</PanelMessage>;
  if (!circuit.data) return <PanelMessage>Loading circuit…</PanelMessage>;
  return <TrackMap group={group} circuit={circuit.data} comparison={data} styles={styles} />;
}

function TrackMap({
  group,
  circuit,
  comparison,
  styles,
}: WidgetProps & { circuit: Circuit; comparison: Comparison | undefined; styles: LapStyle[] }) {
  const zoom = useZoom(group);
  const dotsRef = useRef<SVGGElement>(null);

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

  const u = geometry.unit;
  return (
    <div className="relative h-full">
      {lap ? (
        <div className="absolute left-1.5 top-1 z-10 text-[10px] text-faint">
          Mini-sectors: fastest lap colours the track
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
        {geometry.corners.map((c) => (
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
        <g ref={dotsRef}>
          {styles.map((s, n) => (
            <circle
              key={n}
              r={u * 1.4}
              fill={s.color}
              stroke="#08080a"
              strokeWidth={u * 0.4}
              visibility="hidden"
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
