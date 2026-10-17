import { useMemo } from 'react';
import type uPlot from 'uplot';
import type { ComparedLap } from '@/api/client';
import { useDistanceMarks } from '@/api/markers';
import { UPlotChart, type ChartSeries } from '@/components/chart/UPlotChart';
import { LineSwatch, NoLapsMessage, PanelMessage } from '@/components/data/bits';
import { formatGap } from '@/lib/format';
import { marksAt, type DistanceMark } from '@/lib/markers';
import type { LapStyle } from '@/lib/timing';
import { useCursor, useFrozen } from '@/store/cursor';
import type { GroupId } from '@/store/groups';
import type { WidgetProps } from '../types';
import { useGroupComparison } from '../useGroupComparison';
import type { ChannelKey, TelemetryConfig } from './widget';

type Channel = {
  key: ChannelKey;
  label: string;
  /** Column header in the readout table. */
  short: string;
  flex: number;
  stepped?: boolean;
  yRange?: [number, number];
  yTicks?: (min: number, max: number) => number[];
  format: (value: number) => string;
};

const CHANNELS: Channel[] = [
  { key: 'speed', label: 'Speed km/h', short: 'km/h', flex: 3, format: (v) => v.toFixed(0) },
  {
    key: 'throttle',
    label: 'Throttle %',
    short: 'Thr',
    flex: 1.4,
    yRange: [-5, 105],
    yTicks: () => [0, 50, 100],
    format: (v) => v.toFixed(0),
  },
  {
    key: 'brake',
    label: 'Brake',
    short: 'Brk',
    flex: 0.7,
    stepped: true,
    yRange: [-0.15, 1.15],
    yTicks: () => [0, 1],
    format: (v) => (v ? 'ON' : ''),
  },
  {
    key: 'gear',
    label: 'Gear',
    short: 'Gear',
    flex: 1.2,
    stepped: true,
    yRange: [0.5, 8.5],
    yTicks: () => [2, 4, 6, 8],
    format: (v) => v.toFixed(0),
  },
  { key: 'rpm', label: 'RPM', short: 'RPM', flex: 1.4, format: (v) => v.toFixed(0) },
  {
    key: 'drs',
    label: 'DRS',
    short: 'DRS',
    flex: 0.6,
    stepped: true,
    yRange: [-0.15, 1.15],
    yTicks: () => [0, 1],
    format: (v) => (v ? 'OPEN' : ''),
  },
];

const rpmTicks = (min: number, max: number) => {
  const step = 2000;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t);
  return ticks;
};
const rpmFormat = (v: number) => `${Math.round(v / 1000)}k`;

export function TelemetryWidget({ group, config }: WidgetProps<TelemetryConfig>) {
  const { laps, data, styles, detail, isFetching, error } = useGroupComparison(group, {
    step: config.step,
  });
  const marks = useDistanceMarks(group);

  const channels = useMemo(
    () =>
      CHANNELS.filter(
        (c) => config.channels.includes(c.key) && (c.key !== 'drs' || detail?.has_drs !== false)
      ),
    [config.channels, detail?.has_drs]
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

  if (laps.length === 0) return <NoLapsMessage group={group} />;
  if (error) return <PanelMessage>{error.message}</PanelMessage>;
  if (!data) return <PanelMessage>Loading telemetry…</PanelMessage>;

  return (
    <div className={`flex h-full flex-col ${isFetching ? 'opacity-60' : ''}`}>
      <Readout
        group={group}
        distance={data.distance}
        laps={data.laps}
        styles={styles}
        channels={channels}
        marks={marks}
      />
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
              marks={marks}
              markLabels={i === 0}
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
  channels,
  marks,
}: {
  group: GroupId;
  distance: number[];
  laps: ComparedLap[];
  styles: LapStyle[];
  channels: Channel[];
  marks: DistanceMark[];
}) {
  const cursor = useCursor(group);
  const frozen = useFrozen(group);
  const i = cursor == null ? null : indexAt(distance, cursor);
  const here = cursor == null ? [] : marksAt(marks, cursor);
  const cell = 'w-16 px-1.5 text-right';
  return (
    <div className="flex shrink-0 items-start gap-3">
      <table className="w-auto shrink-0 text-[11px]">
        <thead className="text-[10px] uppercase text-faint">
          <tr>
            <th className="w-32 px-1.5 text-left font-medium">
              {i == null ? 'Hover a chart' : `${Math.round(distance[i])} m`}
              {i != null && frozen ? (
                <span className="ml-1.5 text-text" title="Press f to release">
                  FROZEN
                </span>
              ) : null}
            </th>

            <th className={`${cell} font-medium`}>Δ</th>
            {channels.map((c) => (
              <th key={c.key} className={`${cell} font-medium`}>
                {c.short}
              </th>
            ))}
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
              {channels.map((c) => {
                const value = i == null ? null : lap[c.key]?.[i];
                return (
                  <td key={c.key} className={cell}>
                    {value == null ? '' : c.format(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {here.length > 0 ? (
        <div className="min-w-0 flex-1 text-[11px] text-dim">
          {here.map((m) => (
            <div key={m.id} className="truncate">
              <span className="mr-1.5 text-[10px] uppercase text-faint">Mark</span>
              {m.label}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
