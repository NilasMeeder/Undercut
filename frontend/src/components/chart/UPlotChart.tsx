import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import { COLORS } from '@/lib/colors';
import { formatDistance } from '@/lib/format';
import { marksAt, type DistanceMark } from '@/lib/markers';
import { cursorBus } from '@/store/cursor';
import type { GroupId } from '@/store/groups';
import { editMarker, markNew } from '@/store/markerEditor';

export type ChartSeries = {
  color: string;
  dash?: number[];
  stepped?: boolean;
  width?: number;
};

type Props = {
  group: GroupId;
  /** [distance, ...one array per series] */
  data: uPlot.AlignedData;
  series: ChartSeries[];
  label: string;
  yRange?: [number, number];
  yTicks?: (min: number, max: number) => number[];
  showXAxis?: boolean;
  yFormat?: (value: number) => string;
  /** Distance markers, drawn as bands (ranges) or dashed lines (points). */
  marks?: DistanceMark[];
  /** Write the marker labels in this chart (the top one of a stack). */
  markLabels?: boolean;
};

const FONT = '10px system-ui, sans-serif';
const Y_AXIS_WIDTH = 42;
const X_AXIS_HEIGHT = 18;
const LABEL_HEIGHT = 14;
const NO_MARKS: DistanceMark[] = [];
let nextChartId = 0;

/** Cut text to a width with an ellipsis (canvas maxWidth would squeeze it instead). */
function fitText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let n = text.length;
  while (n > 1 && ctx.measureText(`${text.slice(0, n)}…`).width > width) n--;
  return `${text.slice(0, n)}…`;
}

function drawMarks(u: uPlot, marks: DistanceMark[], labels: boolean) {
  if (marks.length === 0) return;
  const { ctx } = u;
  const { left, top, width, height } = u.bbox;
  const px = uPlot.pxRatio;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  ctx.lineWidth = px;
  ctx.setLineDash([3 * px, 3 * px]);
  ctx.font = `${10 * px}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left'; // uPlot leaves the axis alignment behind
  // Labels that would overlap go one row down (three rows, then they overlap anyway).
  const rowEnds = [-Infinity, -Infinity, -Infinity];
  for (const mark of marks) {
    const x0 = u.valToPos(mark.start, 'x', true);
    const x1 = mark.end == null ? x0 : u.valToPos(mark.end, 'x', true);
    if (x1 < left || x0 > left + width) continue;
    ctx.globalAlpha = mark.dim ? 0.45 : 1;
    if (mark.end != null) {
      ctx.fillStyle = COLORS.markerFill;
      ctx.fillRect(x0, top, x1 - x0, height);
    }
    ctx.strokeStyle = COLORS.textFaint;
    ctx.beginPath();
    for (const x of mark.end == null ? [x0] : [x0, x1]) {
      ctx.moveTo(Math.round(x) + 0.5, top);
      ctx.lineTo(Math.round(x) + 0.5, top + height);
    }
    ctx.stroke();
    if (labels) {
      const text = fitText(ctx, mark.label, 180 * px);
      const x = Math.max(x0, left) + 3 * px;
      const free = rowEnds.findIndex((end) => end < x);
      const row = free < 0 ? 0 : free;
      rowEnds[row] = x + ctx.measureText(text).width + 8 * px;
      ctx.fillStyle = COLORS.textDim;
      ctx.fillText(text, x, top + (2 + row * 12) * px);
    }
  }
  ctx.restore();
}

/**
 * A distance-based uPlot chart wired into its link group's cursor and zoom: hovering moves the
 * group cursor, drag-select zooms the whole group, double-click resets. Shift + drag or Shift + click
 * opens the marker editor for that range or point; a click on a marker edits it.
 */
export function UPlotChart({
  group,
  data,
  series,
  label,
  yRange,
  yTicks,
  showXAxis = false,
  yFormat,
  marks = NO_MARKS,
  markLabels = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const marksRef = useRef(marks);
  const markLabelsRef = useRef(markLabels);

  // Markers change without rebuilding the chart: redraw with the new ones.
  useEffect(() => {
    marksRef.current = marks;
    markLabelsRef.current = markLabels;
    chartRef.current?.redraw(false);
  }, [marks, markLabels]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const id = `chart-${nextChartId++}`;
    const distances = data[0] as number[];
    const fullRange: [number, number] = [distances[0] ?? 0, distances.at(-1) ?? 1];
    const zoom = cursorBus.getZoom(group) ?? fullRange;
    // Shift + drag marks a range and Shift + click a point, instead of zooming.
    let marking = false;
    let downX = 0;

    const opts: uPlot.Options = {
      width: container.clientWidth || 300,
      height: container.clientHeight || 100,
      // Top padding keeps the channel label clear of the plot.
      padding: [LABEL_HEIGHT, 8, showXAxis ? 0 : 4, 0],
      legend: { show: false },
      cursor: {
        y: false,
        drag: { x: true, y: false, setScale: false },
        points: { size: 6, width: 1, stroke: COLORS.text },
      },
      scales: {
        x: { time: false, min: zoom[0], max: zoom[1] },
        y: yRange ? { range: () => yRange } : {},
      },
      axes: [
        {
          show: showXAxis,
          size: X_AXIS_HEIGHT,
          font: FONT,
          stroke: COLORS.textFaint,
          grid: { stroke: COLORS.line, width: 1 },
          ticks: { stroke: COLORS.line, width: 1, size: 3 },
          values: (_u, values) =>
            values.map((v) => formatDistance(v, Math.abs((values[1] ?? Infinity) - values[0]))),
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
        ...series.map((s) => ({
          stroke: s.color,
          width: s.width ?? 1.5,
          dash: s.dash,
          points: { show: false },
          paths: s.stepped ? uPlot.paths.stepped!({ align: 1 }) : undefined,
        })),
      ],
      hooks: {
        setCursor: [
          (u) => {
            if (cursorBus.isFrozen(group)) {
              // Keep this chart's crosshair on the frozen position while the mouse moves.
              const frozenAt = cursorBus.getCursor(group);
              if (frozenAt != null)
                u.setCursor({ left: u.valToPos(frozenAt, 'x'), top: 10 }, false);
              return;
            }
            const left = u.cursor.left;
            const distance = left == null || left < 0 ? null : u.posToVal(left, 'x');
            cursorBus.setCursor(group, distance, id);
          },
        ],
        setSelect: [
          (u) => {
            if (u.select.width > 4) {
              const min = u.posToVal(u.select.left, 'x');
              const max = u.posToVal(u.select.left + u.select.width, 'x');
              if (marking)
                markNew({
                  kind: 'distance',
                  start: Math.round(Math.max(min, 0)),
                  end: Math.round(max),
                  group,
                });
              else cursorBus.setZoom(group, [min, max]);
            }
            u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
          },
        ],
        draw: [(u) => drawMarks(u, marksRef.current, markLabelsRef.current)],
      },
    };

    const chart = new uPlot(opts, data, container);
    chartRef.current = chart;

    const onDoubleClick = () => cursorBus.setZoom(group, null);
    // Pointer events come before uPlot's mouse events, so `marking` is set when the drag ends.
    const onPointerDown = (e: PointerEvent) => {
      marking = e.shiftKey;
      downX = e.clientX;
    };
    const onClick = (e: MouseEvent) => {
      if (Math.abs(e.clientX - downX) > 4) return;
      const distance = chart.posToVal(e.offsetX, 'x');
      if (e.shiftKey) {
        markNew({ kind: 'distance', start: Math.round(Math.max(distance, 0)), group });
        return;
      }
      // A plain click on a marker (a point within a few pixels) opens it in the editor.
      const slack = Math.abs(chart.posToVal(e.offsetX + 5, 'x') - distance);
      const hit = marksAt(marksRef.current, distance, slack)[0];
      if (hit) editMarker(hit.marker, group);
    };
    chart.over.addEventListener('dblclick', onDoubleClick);
    chart.over.addEventListener('pointerdown', onPointerDown);
    chart.over.addEventListener('click', onClick);

    const unsubscribeCursor = cursorBus.subscribeCursor(group, (source) => {
      if (source === id && !cursorBus.isFrozen(group)) return;
      const distance = cursorBus.getCursor(group);
      const left = distance == null ? -10 : chart.valToPos(distance, 'x');
      chart.setCursor({ left, top: 10 }, false);
    });
    const unsubscribeZoom = cursorBus.subscribeZoom(group, () => {
      const [min, max] = cursorBus.getZoom(group) ?? fullRange;
      chart.setScale('x', { min, max });
    });
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) chart.setSize({ width, height });
    });
    resize.observe(container);

    return () => {
      resize.disconnect();
      unsubscribeCursor();
      unsubscribeZoom();
      chart.over.removeEventListener('dblclick', onDoubleClick);
      chart.over.removeEventListener('pointerdown', onPointerDown);
      chart.over.removeEventListener('click', onClick);
      chartRef.current = null;
      chart.destroy();
    };
  }, [group, data, series, yRange, yTicks, showXAxis, yFormat]);

  return (
    <div className="relative min-h-0 flex-1">
      <span className="pointer-events-none absolute left-[46px] top-0 z-10 text-[10px] font-medium uppercase tracking-wide text-faint">
        {label}
      </span>
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
