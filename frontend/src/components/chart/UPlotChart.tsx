import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import { COLORS } from '@/lib/colors';
import { formatDistance } from '@/lib/format';
import { cursorBus } from '@/store/cursor';
import type { GroupId } from '@/store/groups';

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
};

const FONT = '10px system-ui, sans-serif';
const Y_AXIS_WIDTH = 42;
const X_AXIS_HEIGHT = 18;
const LABEL_HEIGHT = 14;
let nextChartId = 0;

/**
 * A distance-based uPlot chart wired into its link group's cursor and zoom: hovering moves the
 * group cursor, drag-select zooms the whole group, double-click resets.
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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const id = `chart-${nextChartId++}`;
    const distances = data[0] as number[];
    const fullRange: [number, number] = [distances[0] ?? 0, distances.at(-1) ?? 1];
    const zoom = cursorBus.getZoom(group) ?? fullRange;

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
          values: (_u, values) => values.map(formatDistance),
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
              cursorBus.setZoom(group, [min, max]);
            }
            u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
          },
        ],
      },
    };

    const chart = new uPlot(opts, data, container);

    const onDoubleClick = () => cursorBus.setZoom(group, null);
    chart.over.addEventListener('dblclick', onDoubleClick);

    const unsubscribeCursor = cursorBus.subscribeCursor(group, (source) => {
      if (source === id) return;
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
