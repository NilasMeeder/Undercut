import { useMemo, useRef } from 'react';
import type { SetupMap } from '@/api/client';
import { useSessionDetail, useSetupMap } from '@/api/queries';
import { PanelMessage } from '@/components/data/bits';
import { COLORS } from '@/lib/colors';
import { formatLapTime } from '@/lib/format';
import { useLapSelection, type GroupId } from '@/store/groups';
import { useElementSize } from '../hooks';
import type { WidgetProps } from '../types';
import type { SetupsConfig } from './widget';

type Row = SetupMap['drivers'][number];
type Point = { row: Row; x: number; y: number };

const PAD = { left: 40, right: 12, top: 12, bottom: 26 };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Round ticks every `step` between min and max. */
function ticks(min: number, max: number, step: number): number[] {
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
  return out;
}

const stepFor = (span: number) => (span > 30 ? 5 : span > 12 ? 2 : 1);

export function SetupsWidget({ group, config }: WidgetProps<SetupsConfig>) {
  const setups = useSetupMap();
  const detail = useSessionDetail();
  const box = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(box);

  const points = useMemo(() => {
    const x = (r: Row) =>
      config.corners === 'slow'
        ? r.slow_corners
        : config.corners === 'fast'
          ? r.fast_corners
          : r.corner_speed;
    const y = (r: Row) => (config.top === 'trap' ? r.speed_trap : r.top_speed);
    return (setups.data?.drivers ?? []).flatMap((r) => {
      const px = x(r);
      const py = y(r);
      return px != null && py != null ? [{ row: r, x: px, y: py }] : [];
    });
  }, [setups.data, config.corners, config.top]);

  const drivers = detail.data?.drivers;
  // The box is always rendered, so its size is known by the time the data arrives.
  return (
    <div ref={box} className="relative h-full overflow-hidden">
      {setups.error ? (
        <PanelMessage>{setups.error.message}</PanelMessage>
      ) : !setups.data || !drivers ? (
        <PanelMessage>Loading best laps…</PanelMessage>
      ) : points.length < 2 ? (
        <PanelMessage>Not enough laps with telemetry.</PanelMessage>
      ) : width > 0 && height > 0 ? (
        <Plot
          group={group}
          config={config}
          points={points}
          width={width}
          height={height}
          colorOf={(code) => drivers.find((d) => d.code === code)?.color ?? COLORS.text}
        />
      ) : null}
    </div>
  );
}

function Plot({
  group,
  config,
  points,
  width,
  height,
  colorOf,
}: {
  group: GroupId;
  config: SetupsConfig;
  points: Point[];
  width: number;
  height: number;
  colorOf: (code: string) => string;
}) {
  const { isSelected, toggle } = useLapSelection(group);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs) - 1;
  const xMax = Math.max(...xs) + 1;
  const yMin = Math.min(...ys) - 1;
  const yMax = Math.max(...ys) + 1;
  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = Math.max(height - PAD.top - PAD.bottom, 1);
  const sx = (v: number) => PAD.left + ((v - xMin) / (xMax - xMin)) * plotW;
  const sy = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  const mx = median(xs);
  const my = median(ys);
  const xLabel = {
    slow: 'Slow corners: mean minimum km/h',
    fast: 'Medium and fast corners: mean minimum km/h',
    all: 'All corners: mean minimum km/h',
  }[config.corners];

  return (
    <svg width={width} height={height} className="block text-[10px]">
      {ticks(xMin, xMax, stepFor(xMax - xMin)).map((v) => (
        <g key={`x${v}`}>
          <line x1={sx(v)} x2={sx(v)} y1={PAD.top} y2={PAD.top + plotH} stroke={COLORS.line} />
          <text x={sx(v)} y={height - 14} textAnchor="middle" fill={COLORS.textFaint}>
            {v}
          </text>
        </g>
      ))}
      {ticks(yMin, yMax, stepFor(yMax - yMin)).map((v) => (
        <g key={`y${v}`}>
          <line x1={PAD.left} x2={PAD.left + plotW} y1={sy(v)} y2={sy(v)} stroke={COLORS.line} />
          <text x={PAD.left - 4} y={sy(v) + 3} textAnchor="end" fill={COLORS.textFaint}>
            {v}
          </text>
        </g>
      ))}
      <line
        x1={sx(mx)}
        x2={sx(mx)}
        y1={PAD.top}
        y2={PAD.top + plotH}
        stroke={COLORS.textFaint}
        strokeDasharray="3 3"
      />
      <line
        x1={PAD.left}
        x2={PAD.left + plotW}
        y1={sy(my)}
        y2={sy(my)}
        stroke={COLORS.textFaint}
        strokeDasharray="3 3"
      />
      <text x={PAD.left + 4} y={PAD.top + 10} fill={COLORS.textFaint}>
        LOW DRAG
      </text>
      <text
        x={PAD.left + plotW - 4}
        y={PAD.top + plotH - 4}
        textAnchor="end"
        fill={COLORS.textFaint}
      >
        HIGH DOWNFORCE
      </text>
      <text x={PAD.left + plotW / 2} y={height - 3} textAnchor="middle" fill={COLORS.textFaint}>
        {xLabel}
      </text>
      <text
        transform={`translate(10 ${PAD.top + plotH / 2}) rotate(-90)`}
        textAnchor="middle"
        fill={COLORS.textFaint}
      >
        {config.top === 'trap' ? 'Speed trap km/h' : 'Top speed km/h'}
      </text>
      {points.map(({ row, x, y }) => {
        const ref = { driver: row.driver, lap: row.lap };
        const selected = isSelected(ref);
        return (
          <g key={row.driver} className="cursor-pointer" onClick={() => toggle(ref)}>
            <title>
              {`${row.driver} L${row.lap} ${formatLapTime(row.lap_time)}\n` +
                `top ${row.top_speed} km/h, trap ${row.speed_trap ?? '–'}\n` +
                `corners ${row.corner_speed ?? '–'} (slow ${row.slow_corners ?? '–'}, ` +
                `fast ${row.fast_corners ?? '–'})`}
            </title>
            <circle
              cx={sx(x)}
              cy={sy(y)}
              r={selected ? 5 : 3.5}
              fill={colorOf(row.driver)}
              stroke={selected ? COLORS.text : 'none'}
              strokeWidth={1.5}
            />
            <text
              x={sx(x) + 6}
              y={sy(y) + 3}
              fill={selected ? COLORS.text : COLORS.textDim}
              fontWeight={selected ? 600 : 400}
            >
              {row.driver}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
