import { useMemo } from 'react';
import type uPlot from 'uplot';
import type { ComparedLap } from '@/api/client';
import { UPlotChart, type ChartSeries } from '@/components/chart/UPlotChart';
import { LineSwatch, PanelMessage } from '@/components/data/bits';
import { formatGap } from '@/lib/format';
import type { LapStyle } from '@/lib/timing';
import { useCursor } from '@/store/cursor';
import type { GroupId } from '@/store/groups';
import type { WidgetProps } from '../types';
import { useGroupComparison } from '../useGroupComparison';

type ChannelKey = 'speed' | 'throttle' | 'brake' | 'gear' | 'rpm' | 'drs';

type Channel = {
  key: ChannelKey;
  label: string;
  flex: number;
  stepped?: boolean;
  yRange?: [number, number];
  yTicks?: (min: number, max: number) => number[];
  format: (value: number) => string;
};

const CHANNELS: Channel[] = [
  { key: 'speed', label: 'Speed km/h', flex: 3, format: (v) => v.toFixed(0) },
  {
    key: 'throttle',
    label: 'Throttle %',
    flex: 1.4,
    yRange: [-5, 105],
    yTicks: () => [0, 50, 100],
    format: (v) => v.toFixed(0),
  },
  {
    key: 'brake',
    label: 'Brake',
    flex: 0.7,
    stepped: true,
    yRange: [-0.15, 1.15],
    yTicks: () => [0, 1],
    format: (v) => (v ? 'ON' : '–'),
  },
  {
    key: 'gear',
    label: 'Gear',
    flex: 1.2,
    stepped: true,
    yRange: [0.5, 8.5],
    yTicks: () => [2, 4, 6, 8],
    format: (v) => v.toFixed(0),
  },
  { key: 'rpm', label: 'RPM', flex: 1.4, format: (v) => v.toFixed(0) },
  {
    key: 'drs',
    label: 'DRS',
    flex: 0.6,
    stepped: true,
    yRange: [-0.15, 1.15],
    yTicks: () => [0, 1],
    format: (v) => (v ? 'OPEN' : '–'),
  },
];

const rpmTicks = (min: number, max: number) => {
  const step = 2000;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t);
  return ticks;
};
const rpmFormat = (v: number) => `${Math.round(v / 1000)}k`;

export function TelemetryWidget({ group }: WidgetProps) {
  const { laps, data, styles, detail, isFetching, error } = useGroupComparison(group);

  const channels = useMemo(
    () => CHANNELS.filter((c) => c.key !== 'drs' || detail?.has_drs !== false),
    [detail?.has_drs]
  );
  const charts = useMemo(() => {
    if (!data) return [];
    return channels.map((channel) => {
      const values = data.laps.map((lap) => lap[channel.key] ?? []);
      const series: ChartSeries[] = styles.map((s) => ({
        color: s.color,
        dash: s.dash,
        stepped: channel.stepped,
      }));
      return { channel, data: [data.distance, ...values] as uPlot.AlignedData, series };
    });
  }, [data, styles, channels]);

  if (laps.length === 0) return <PanelMessage>Select laps in the Laps panel.</PanelMessage>;
  if (error) return <PanelMessage>{error.message}</PanelMessage>;
  if (!data) return <PanelMessage>Loading telemetry…</PanelMessage>;

  return (
    <div className={`flex h-full flex-col ${isFetching ? 'opacity-60' : ''}`}>
      <Readout group={group} distance={data.distance} laps={data.laps} styles={styles} />
      <div className="flex min-h-0 flex-1 flex-col">
        {charts.map(({ channel, data: chartData, series }, i) => (
          <div
            key={channel.key}
            className="flex min-h-0 border-t border-line"
            style={{ flex: channel.flex }}
          >
            <UPlotChart
              group={group}
              data={chartData}
              series={series}
              label={channel.label}
              yRange={channel.yRange}
              yTicks={channel.key === 'rpm' ? rpmTicks : channel.yTicks}
              yFormat={channel.key === 'rpm' ? rpmFormat : undefined}
              showXAxis={i === charts.length - 1}
            />
          </div>
        ))}
      </div>
    </div>
  );
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

/** Values of every lap at the group cursor: the table twin of the charts. */
function Readout({
  group,
  distance,
  laps,
  styles,
}: {
  group: GroupId;
  distance: number[];
  laps: ComparedLap[];
  styles: LapStyle[];
}) {
  const cursor = useCursor(group);
  const i = cursor == null ? null : indexAt(distance, cursor);
  const cell = 'w-16 px-1.5 text-right';
  return (
    <table className="w-auto shrink-0 self-start text-[11px]">
      <thead className="text-[10px] uppercase text-faint">
        <tr>
          <th className="w-32 px-1.5 text-left font-medium">
            {i == null ? 'Hover a chart' : `${Math.round(distance[i])} m`}
          </th>
          <th className={`${cell} font-medium`}>Δ</th>
          <th className={`${cell} font-medium`}>km/h</th>
          <th className={`${cell} font-medium`}>Thr</th>
          <th className={`${cell} font-medium`}>Brk</th>
          <th className={`${cell} font-medium`}>Gear</th>
          <th className={`${cell} font-medium`}>RPM</th>
        </tr>
      </thead>
      <tbody>
        {laps.map((lap, n) => (
          <tr key={`${lap.driver}-${lap.lap}`}>
            <td className="flex items-center gap-1.5 px-1.5">
              <LineSwatch color={styles[n].color} dash={styles[n].dash} />
              {lap.driver} <span className="text-faint">L{lap.lap}</span>
            </td>
            <td className={cell}>{i == null ? '' : n === 0 ? 'REF' : formatGap(lap.delta[i])}</td>
            <td className={cell}>{i == null ? '' : lap.speed[i].toFixed(0)}</td>
            <td className={cell}>{i == null ? '' : lap.throttle[i].toFixed(0)}</td>
            <td className={cell}>{i == null ? '' : lap.brake[i] ? 'ON' : ''}</td>
            <td className={cell}>{i == null ? '' : lap.gear[i]}</td>
            <td className={cell}>{i == null ? '' : lap.rpm[i].toFixed(0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
