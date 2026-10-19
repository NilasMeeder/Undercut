import { type ReactNode, useRef, useState } from 'react';
import type { DriverInfo, StartCar, Starts } from '@/api/client';
import { useSessionDetail, useStarts } from '@/api/queries';
import { DriverCell, PanelMessage } from '@/components/data/bits';
import { COLORS } from '@/lib/colors';
import { formatGap } from '@/lib/format';
import { rowStyle, td, th } from '@/lib/table';
import { cn } from '@/lib/utils';
import { useClockTime } from '@/store/clock';
import { useLapSelection } from '@/store/groups';
import { useSelection } from '@/store/selection';
import { useElementSize } from '../hooks';
import type { WidgetProps } from '../types';
import { useGroupDrivers } from '../useStrategy';
import type { StartsConfig } from './widget';

/** What the clock has reached: checkpoint k of a car counts once lights out + its time ≤ t. */
type Seen = { t: number; lightsOut: number };

const passed = (car: StartCar, k: number, seen: Seen) =>
  car.times[k] != null && seen.lightsOut + car.times[k]! <= seen.t;

export function StartsWidget({ group, config }: WidgetProps<StartsConfig>) {
  const race = useSelection((s) => s.session === 'R' || s.session === 'S');
  const starts = useStarts(race);
  const detail = useSessionDetail();
  const t = useClockTime(200);
  const selected = useGroupDrivers(group);
  const { isSelected, toggle } = useLapSelection(group);
  /** The start picked above the chart; null = the last one the clock has reached. */
  const [pick, setPick] = useState<number | null>(null);

  if (!race) return <PanelMessage>Starts are for races and sprints.</PanelMessage>;
  if (starts.error) return <PanelMessage>{starts.error.message}</PanelMessage>;
  if (!starts.data?.length || !detail.data) return <PanelMessage>Loading the start…</PanelMessage>;
  const all = starts.data;
  const reached = all.findLastIndex((s) => s.lights_out <= t);
  const index = pick != null && pick < all.length ? pick : Math.max(reached, 0);
  const data = all[index];
  const drivers = detail.data.drivers;
  const seen = { t, lightsOut: data.lights_out };
  const last = data.checkpoints.length - 1;
  const picker =
    all.length > 1 ? <StartPicker all={all} index={index} pick={pick} onPick={setPick} /> : null;
  if (t < data.lights_out)
    return (
      <div className="flex h-full flex-col">
        {picker}
        <PanelMessage>
          {data.restart
            ? 'This restart is the first thing after its lights out at the clock.'
            : 'The start is the first thing after lights out at the clock.'}
        </PanelMessage>
      </div>
    );
  // The order at the last checkpoint once everyone who got there has, else the grid.
  const leader = data.cars.find((c) => c.positions[last] === 1);

  return (
    <Split
      top={picker}
      chart={
        config.chart
          ? (beside) => (
              <PlacesChart
                data={data}
                drivers={drivers}
                seen={seen}
                strong={selected}
                beside={beside}
              />
            )
          : null
      }
    >
      <table className="w-full whitespace-nowrap text-[11px] tabular-nums">
        <thead>
          <tr>
            <th className={cn(th, 'text-right')} title="Place 500 m past the pole slot">
              Pos
            </th>
            <th className={cn(th, 'text-left')}>Drv</th>
            <th className={cn(th, 'text-right')}>Grid</th>
            <th className={cn(th, 'text-right')} title="Places gained (+) or lost by 500 m">
              ±
            </th>
            <th className={cn(th, 'text-right')} title="Behind the first car at 500 m">
              Gap
            </th>
            <th className={cn(th, 'text-right')} title="Top speed up to 500 m (km/h)">
              Vmax
            </th>
            <th className={cn(th, 'text-right')} title="Seconds from lights out (±0.25 s)">
              0–100
            </th>
            <th className={cn(th, 'text-right')} title="Seconds from lights out (±0.25 s)">
              0–200
            </th>
            <th className={cn(th, 'text-right')} title={`Place at the end of lap ${data.lap}`}>
              L{data.lap}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.cars.map((car) => {
            const lap = { driver: car.driver, lap: 1 };
            const picked = isSelected(lap);
            const at500 = passed(car, last, seen);
            const pos = at500 ? car.positions[last] : null;
            const gained = pos != null && car.grid != null ? car.grid - pos : null;
            const lap1 = car.lap_1_end != null && car.lap_1_end <= t ? car.lap_1 : null;
            const note = car.pit_lane ? 'PIT' : !car.moved ? (car.lap_1 ? 'NO DATA' : 'DNS') : '';
            return (
              <tr
                key={car.driver}
                onClick={() => toggle(lap)}
                style={rowStyle(picked, group)}
                className={cn('cursor-pointer hover:bg-raised', picked && 'bg-raised')}
              >
                <td className={cn(td, 'font-semibold')}>{pos ?? ''}</td>
                <DriverCell code={car.driver} drivers={drivers} />
                <td className={cn(td, 'text-dim')}>{car.grid ?? ''}</td>
                <td className={cn(td, gained ? 'text-text' : 'text-faint')}>
                  {gained == null
                    ? ''
                    : gained > 0
                      ? `+${gained}`
                      : gained < 0
                        ? `−${-gained}`
                        : '0'}
                </td>
                <td className={cn(td, 'text-dim')}>
                  {note ? (
                    <span className="text-faint">{note}</span>
                  ) : at500 && leader && car !== leader ? (
                    formatGap(car.times[last]! - leader.times[last]!)
                  ) : (
                    ''
                  )}
                </td>
                <td className={cn(td, 'text-dim')}>{at500 ? (car.speed ?? '') : ''}</td>
                <td className={td}>
                  {car.to_100 != null && data.lights_out + car.to_100 <= t
                    ? car.to_100.toFixed(2)
                    : ''}
                </td>
                <td className={td}>
                  {car.to_200 != null && data.lights_out + car.to_200 <= t
                    ? car.to_200.toFixed(2)
                    : ''}
                </td>
                <td className={cn(td, 'text-dim')}>{lap1 ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Split>
  );
}

/** The chart over the table, or beside it when the panel is wide and low (the race board). */
function Split({
  top,
  chart,
  children,
}: {
  top: ReactNode;
  chart: ((beside: boolean) => ReactNode) | null;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(box);
  const beside = chart != null && width >= 480 && width >= 2 * height;
  return (
    <div className="flex h-full flex-col">
      {top}
      <div ref={box} className={cn('flex min-h-0 flex-1', beside ? 'flex-row' : 'flex-col')}>
        {chart?.(beside)}
        <div
          className={cn(
            'min-h-0 overflow-auto border-line',
            beside ? 'shrink-0 border-l' : 'flex-1 border-t'
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** AUTO (the last start the clock has reached), the race start and every restart. */
function StartPicker({
  all,
  index,
  pick,
  onPick,
}: {
  all: Starts[];
  index: number;
  pick: number | null;
  onPick: (pick: number | null) => void;
}) {
  const button = (key: string, label: string, title: string, on: boolean, value: number | null) => (
    <button
      key={key}
      type="button"
      title={title}
      onClick={() => onPick(value)}
      className={cn('font-semibold', on ? 'text-text' : 'text-faint hover:text-dim')}
    >
      {label}
    </button>
  );
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line px-1.5 py-0.5 text-[10px]">
      {button('auto', 'AUTO', 'The last start the clock has reached', pick == null, null)}
      {all.map((s, k) =>
        button(
          String(k),
          !s.restart ? 'START' : all.length > 2 ? `RESTART ${k}` : 'RESTART',
          s.restart
            ? `Standing restart after the red flag; the grid is the order the cars stood in`
            : 'The race start',
          pick != null && k === index,
          k
        )
      )}
    </div>
  );
}

const PAD = { left: 34, right: 34, top: 14, bottom: 4 };
/** Pixels a row needs for its name. */
const LABEL_ROW = 10;

/** Places from the grid through every checkpoint to the end of lap 1, a line per car. */
function PlacesChart({
  data,
  drivers,
  seen,
  strong,
  beside,
}: {
  data: Starts;
  drivers: DriverInfo[];
  seen: Seen;
  strong: string[];
  /** Next to the table: the full height of the panel. */
  beside: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(box);
  const columns = ['GRID', ...data.checkpoints.map((c) => `${c}`), `L${data.lap}`];
  const field = data.cars.length;
  const x = (k: number) =>
    PAD.left + (k / (columns.length - 1)) * Math.max(width - PAD.left - PAD.right, 1);
  const y = (place: number) =>
    PAD.top + ((place - 1) / Math.max(field - 1, 1)) * Math.max(height - PAD.top - PAD.bottom, 1);
  const color = (code: string) => drivers.find((d) => d.code === code)?.color ?? COLORS.textDim;
  // Every car's name only when the rows have room; else only those of the group.
  const roomy = (height - PAD.top - PAD.bottom) / Math.max(field - 1, 1) >= LABEL_ROW;
  // "100 m" needs about 30 px; closer together the column says only "100".
  const metres = (width - PAD.left - PAD.right) / (columns.length - 1) >= 32;
  const lines = data.cars.map((car) => {
    const places: (number | null)[] = [
      car.grid,
      ...car.positions.map((p, k) => (passed(car, k, seen) ? p : null)),
      car.lap_1_end != null && car.lap_1_end <= seen.t ? car.lap_1 : null,
    ];
    return { car, places };
  });
  // Faint cars first, so the group's drivers lie on top.
  lines.sort(
    (a, b) => Number(strong.includes(a.car.driver)) - Number(strong.includes(b.car.driver))
  );
  return (
    <div
      ref={box}
      className={cn('relative', beside ? 'min-w-0 flex-1' : 'min-h-[90px] shrink-0')}
      style={
        beside
          ? undefined
          : { height: `min(55%, ${field * LABEL_ROW + PAD.top + PAD.bottom + 4}px)` }
      }
    >
      {width > 0 ? (
        <svg width={width} height={height} className="block">
          {columns.map((label, k) => (
            <g key={label}>
              <line
                x1={x(k)}
                x2={x(k)}
                y1={PAD.top - 2}
                y2={height - PAD.bottom}
                stroke={COLORS.line}
              />
              <text x={x(k)} y={9} fill={COLORS.textFaint} fontSize={9} textAnchor="middle">
                {k > 0 && k < columns.length - 1 && metres ? `${label} m` : label}
              </text>
            </g>
          ))}
          {lines.map(({ car, places }) => {
            const on = strong.includes(car.driver);
            let d = '';
            let pen = false;
            places.forEach((p, k) => {
              if (p == null) {
                pen = false;
                return;
              }
              d += `${pen ? 'L' : 'M'}${x(k).toFixed(1)},${y(p).toFixed(1)}`;
              pen = true;
            });
            const end = places.findLastIndex((p) => p != null);
            return (
              <g key={car.driver} opacity={on || strong.length === 0 ? 1 : 0.4}>
                <title>{`${car.driver}: ${places.map((p, k) => `${columns[k]} ${p ?? '–'}`).join(', ')}`}</title>
                <path d={d} fill="none" stroke={color(car.driver)} strokeWidth={on ? 2 : 1.2} />
                {car.grid != null && (roomy || on) ? (
                  <text
                    x={x(0) - 4}
                    y={y(car.grid)}
                    fill={on ? COLORS.text : COLORS.textDim}
                    fontSize={9}
                    textAnchor="end"
                    dominantBaseline="central"
                  >
                    {car.driver}
                  </text>
                ) : null}
                {end > 0 && (roomy || on) ? (
                  <text
                    x={x(end) + 4}
                    y={y(places[end]!)}
                    fill={on ? COLORS.text : COLORS.textDim}
                    fontSize={9}
                    dominantBaseline="central"
                  >
                    {car.driver}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      ) : null}
    </div>
  );
}
