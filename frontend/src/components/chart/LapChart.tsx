import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import { COLORS } from '@/lib/colors';
import type { LapBand } from '@/lib/strategy';
import type { GroupId } from '@/store/groups';

export type LapSeries = {
  label: string;
  color: string;
  dash?: number[];
  /** Drawn on top, thicker, with a label at its last point and in the readout. */
  strong?: boolean;
  /** Points only (lap times), no line. */
  points?: boolean;
  /** Hidden from the readout and labels (fit lines). */
  quiet?: boolean;
};

type Props = {
  group: GroupId;
  /** [laps, ...one array per series]; null = no value on that lap. */
  data: uPlot.AlignedData;
  series: LapSeries[];
  xRange: [number, number];
  /** Fixed y range; otherwise uPlot fits the data. */
  yRange?: [number, number];
  /** Larger values lower (gaps, positions). */
  invertY?: boolean;
  yFormat?: (value: number) => string;
  yTicks?: (min: number, max: number) => number[];
  xLabel?: string;
  bands?: LapBand[];
  /** The session clock on the lap axis; a white line. */
  clockLap?: number | null;
  /** Readout text for a value. */
  format?: (value: number) => string;
};

const FONT = '10px system-ui, sans-serif';
const Y_AXIS_WIDTH = 46;
const LABEL_SPACE = 34;
const NO_BANDS: LapBand[] = [];

function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function lastIndex(values: (number | null | undefined)[]): number {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return i;
  return -1;
}

/**
 * A chart over laps (x = lap number, at the line). Hover shows the values of the highlighted
 * drivers at that lap; charts of one link group share the hover position. Drag zooms the laps,
 * double-click resets. Safety car periods are bands; the session clock is a line.
 */
export function LapChart({
  group,
  data,
  series,
  xRange,
  yRange,
  invertY = false,
  yFormat,
  yTicks,
  xLabel = 'LAP',
  bands = NO_BANDS,
  clockLap = null,
  format = (v) => v.toFixed(3),
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const live = useRef({ bands, clockLap, series, format });
  live.current = { bands, clockLap, series, format };

  // The clock and bands change without rebuilding the chart.
  useEffect(() => {
    chartRef.current?.redraw(false);
  }, [bands, clockLap]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const strongLabels = series.some((s) => s.strong && !s.quiet);

    const readout = (u: uPlot) => {
      const el = readoutRef.current;
      if (!el) return;
      const idx = u.cursor.idx;
      el.replaceChildren();
      if (idx == null) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      const lap = document.createElement('span');
      lap.className = 'font-semibold text-text';
      lap.textContent = `L${u.data[0][idx]}`;
      el.append(lap);
      const { series: current, format: fmt } = live.current;
      const shown = current
        .map((s, i) => ({ s, value: u.data[i + 1]?.[idx] }))
        .filter(({ s, value }) => !s.quiet && value != null && (s.strong || !strongLabels))
        .sort((a, b) => ((a.value as number) - (b.value as number)) * (invertY ? 1 : -1))
        .slice(0, 12);
      for (const { s, value } of shown) {
        const item = document.createElement('span');
        item.className = 'inline-flex items-center gap-1';
        const swatch = document.createElement('i');
        swatch.className = 'inline-block h-2 w-[3px]';
        swatch.style.background = s.color;
        item.append(swatch, `${s.label} ${fmt(value as number)}`);
        el.append(item);
      }
    };

    const drawBands = (u: uPlot) => {
      const { ctx } = u;
      const { left, top, width, height } = u.bbox;
      const px = uPlot.pxRatio;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, width, height);
      ctx.clip();
      ctx.font = `${9 * px}px system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      for (const band of live.current.bands) {
        const x0 = u.valToPos(band.from, 'x', true);
        const x1 = u.valToPos(band.to, 'x', true);
        ctx.fillStyle = withAlpha(band.color, 0.1);
        ctx.fillRect(x0, top, Math.max(x1 - x0, px), height);
        ctx.fillStyle = band.color;
        ctx.fillText(band.label, x0 + 2 * px, top + 2 * px);
      }
      ctx.restore();
    };

    const drawOverlay = (u: uPlot) => {
      const { ctx } = u;
      const { left, top, width, height } = u.bbox;
      const px = uPlot.pxRatio;
      const { clockLap: at, series: current } = live.current;
      ctx.save();
      if (at != null && at < xRange[1]) {
        const x = Math.round(u.valToPos(at, 'x', true)) + 0.5;
        if (x >= left && x <= left + width) {
          ctx.strokeStyle = COLORS.textDim;
          ctx.lineWidth = px;
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, top + height);
          ctx.stroke();
        }
      }
      // Driver codes at the end of the highlighted lines (labels may overlap: nudge them apart).
      ctx.font = `600 ${10 * px}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const labels = current
        .map((s, i) => ({ s, values: u.data[i + 1] as (number | null)[] }))
        .filter(({ s }) => s.strong && !s.quiet && !s.points)
        .map(({ s, values }) => {
          const i = lastIndex(values);
          if (i < 0) return null;
          const x = u.valToPos(u.data[0][i], 'x', true);
          const y = u.valToPos(values[i] as number, 'y', true);
          if (x < left || x > left + width || y < top || y > top + height) return null;
          return { s, x, y };
        })
        .filter((l) => l != null)
        .sort((a, b) => a.y - b.y);
      let lastY = -Infinity;
      for (const label of labels) {
        const y = Math.max(label.y, lastY + 11 * px);
        lastY = y;
        ctx.fillStyle = COLORS.text;
        ctx.fillText(label.s.label, label.x + 4 * px, y);
      }
      ctx.restore();
    };

    const opts: uPlot.Options = {
      width: box.clientWidth || 300,
      height: box.clientHeight || 150,
      padding: [8, LABEL_SPACE, 0, 0],
      legend: { show: false },
      cursor: {
        y: false,
        drag: { x: true, y: false },
        points: { size: 5, width: 1, stroke: COLORS.text },
        sync: { key: `laps-${group}` },
      },
      scales: {
        x: { time: false, min: xRange[0], max: xRange[1] },
        y: { dir: invertY ? -1 : 1, ...(yRange ? { range: () => yRange } : {}) },
      },
      axes: [
        {
          size: 18,
          font: FONT,
          stroke: COLORS.textFaint,
          grid: { stroke: COLORS.line, width: 1 },
          ticks: { stroke: COLORS.line, width: 1, size: 3 },
          values: (_u, values) => values.map((v) => (Number.isInteger(v) ? String(v) : '')),
        },
        {
          size: Y_AXIS_WIDTH,
          font: FONT,
          stroke: COLORS.textFaint,
          grid: { stroke: COLORS.line, width: 1 },
          ticks: { show: false },
          splits: yTicks ? (_u, _axis, min, max) => yTicks(min, max) : undefined,
          values: yFormat ? (_u, values) => values.map(yFormat) : undefined,
        },
      ],
      series: [
        {},
        ...series.map((s) => {
          const faint = strongLabels && !s.strong;
          const stroke = faint ? withAlpha(s.color, 0.3) : s.color;
          return s.points
            ? {
                stroke,
                fill: stroke,
                paths: () => null,
                points: { show: true, size: s.strong || !strongLabels ? 5 : 4, width: 0 },
              }
            : {
                stroke: s.quiet ? withAlpha(s.color, 0.8) : stroke,
                width: s.strong ? 2 : s.quiet ? 1.5 : 1,
                dash: s.dash,
                spanGaps: false,
                points: { show: false },
              };
        }),
      ],
      hooks: {
        drawClear: [drawBands],
        draw: [drawOverlay],
        setCursor: [readout],
      },
    };
    const chart = new uPlot(opts, data, box);
    chartRef.current = chart;
    const onDoubleClick = () => chart.setScale('x', { min: xRange[0], max: xRange[1] });
    chart.over.addEventListener('dblclick', onDoubleClick);
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) chart.setSize({ width, height });
    });
    resize.observe(box);
    return () => {
      resize.disconnect();
      chart.over.removeEventListener('dblclick', onDoubleClick);
      chartRef.current = null;
      chart.destroy();
    };
    // `data` is pushed with setData below; everything else rebuilds the chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, series, xRange[0], xRange[1], yRange?.[0], yRange?.[1], invertY, yFormat, yTicks]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const x = chart.scales.x;
    chart.setData(data, false);
    chart.setScale('x', { min: x.min ?? xRange[0], max: x.max ?? xRange[1] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div className="relative min-h-0 flex-1">
      <span className="pointer-events-none absolute bottom-[3px] right-1 z-10 text-[9px] uppercase text-faint">
        {xLabel}
      </span>
      <div
        ref={readoutRef}
        hidden
        className="pointer-events-none absolute left-[50px] top-0 z-10 flex max-w-[calc(100%-60px)] flex-wrap gap-x-2 bg-panel/80 px-1 text-[10px] text-dim"
      />
      <div ref={boxRef} className="absolute inset-0" />
    </div>
  );
}
