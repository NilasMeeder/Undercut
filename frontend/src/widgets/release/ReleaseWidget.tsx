import { useMemo } from 'react';
import type { Lap } from '@/api/client';
import { useLaps, useReplayPositions, useSessionDetail, useTimingState } from '@/api/queries';
import { NoLapsMessage, PanelMessage } from '@/components/data/bits';
import { COLORS } from '@/lib/colors';
import { formatGap } from '@/lib/format';
import { carAt, formatClock } from '@/lib/replay';
import { paces, plan, releaseWindow, type CarPlan, type Conflict } from '@/lib/release';
import { td, th } from '@/lib/table';
import { cn } from '@/lib/utils';
import { useClockTime } from '@/store/clock';
import { useGroupLaps } from '@/store/groups';
import type { WidgetProps } from '../types';
import type { ReleaseConfig } from './widget';

const KIND_LABEL = { out: 'OUT', push: 'PUSH', cool: 'COOL' } as const;

function describe(c: Conflict): string {
  if (c.what === 'catch') return `catches ${c.driver} (cool-down) at ${Math.round(c.at * 100)}%`;
  if (c.what === 'behind') return `${c.driver} pushes ${c.gap.toFixed(1)} s behind`;
  return `${c.driver} pushes ${(-c.gap).toFixed(1)} s ahead (dirty air)`;
}

/** Whether a driver's last lap done at t was a push lap: the next one is then a cool-down. */
function pushedLast(laps: Lap[], driver: string, t: number, best: number | undefined): boolean {
  const done = laps.filter((l) => l.driver === driver && l.end_time != null && l.end_time <= t);
  const last = done.reduce<Lap | null>((a, l) => (!a || l.lap > a.lap ? l : a), null);
  return (
    last != null &&
    !last.pit_out &&
    last.lap_time != null &&
    best != null &&
    last.lap_time <= best * 1.03
  );
}

export function ReleaseWidget({ group, config }: WidgetProps<ReleaseConfig>) {
  const selected = useGroupLaps(group);
  const driver = selected[0]?.driver;
  const laps = useLaps();
  const detail = useSessionDetail();
  const timing = useTimingState();
  const { track, status, error } = useReplayPositions();
  const t = useClockTime(1000);

  const result = useMemo(() => {
    if (!laps.data || !timing.data || !track || !driver) return null;
    const p = paces(laps.data, t);
    const cars: CarPlan[] = [];
    track.cars.forEach((car, i) => {
      const row = timing.data!.rows.find((r) => r.driver === car.driver);
      const at = carAt(track, i, t);
      if (!row || !at) return;
      const previous = pushedLast(laps.data!, car.driver, t, p.push.get(car.driver));
      const planned = plan(car.driver, row.status, at.progress, previous, t, p);
      if (planned) cars.push(planned);
    });
    const window = releaseWindow(driver, t, cars, p, config.horizon);
    const firstClear = window.find((w) => w.conflicts.length === 0);
    return { cars, window, firstClear, out: p.out.get(driver) ?? p.outDefault };
  }, [laps.data, timing.data, track, driver, t, config.horizon]);

  if (!driver) return <NoLapsMessage group={group} />;
  if (error) return <PanelMessage>{error.message}</PanelMessage>;
  if (timing.data && timing.data.kind === 'race')
    return <PanelMessage>Release is for qualifying and practice.</PanelMessage>;
  if (!track)
    return (
      <PanelMessage>
        {`${status?.phase ?? 'Preparing positions'}… ${Math.round((status?.progress ?? 0) * 100)}%`}
      </PanelMessage>
    );
  if (!result || !detail.data) return <PanelMessage>Loading…</PanelMessage>;

  const now = result.window[0];
  const row = timing.data?.rows.find((r) => r.driver === driver);
  const onTrack = row != null && row.status !== 'pit' && row.status !== 'garage';
  const near = result.cars
    .filter((c) => c.driver !== driver)
    .map((c) => {
      const start = c.segments.find((s) => s.kind === 'push');
      return { car: c, gap: start ? start.start - now.start : null };
    })
    .filter((c) => c.gap != null && Math.abs(c.gap) < 40)
    .sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0));

  return (
    <div className="flex h-full flex-col text-[11px]">
      <div className="shrink-0 space-y-0.5 border-b border-line px-1.5 py-1">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold">{driver}</span>
          <span className="text-faint">
            leaves now → push lap from {formatClock(now.start)} (out-lap {Math.round(result.out)} s)
          </span>
          {onTrack ? <span className="ml-auto text-faint">on track now</span> : null}
        </div>
        <div className={now.conflicts.length ? 'text-clip' : 'text-pb'}>
          {now.conflicts.length ? now.conflicts.map(describe).join(' · ') : 'Clear lap'}
        </div>
        <div className="text-dim">
          {result.firstClear == null
            ? `No clear lap in the next ${formatClock(config.horizon)}`
            : result.firstClear.wait === 0
              ? 'Go now'
              : `First clear release in ${result.firstClear.wait} s`}
        </div>
        <svg
          width="100%"
          height="10"
          className="block"
          preserveAspectRatio="none"
          viewBox={`0 0 ${result.window.length} 1`}
        >
          {result.window.map((w, i) => (
            <rect
              key={i}
              x={i}
              y={0}
              width={1}
              height={1}
              fill={w.conflicts.length ? COLORS.clip : COLORS.pb}
              opacity={w.conflicts.length ? 0.6 : 0.8}
            />
          ))}
        </svg>
        <div className="flex justify-between text-[10px] text-faint">
          <span>now</span>
          <span>+{formatClock(config.horizon)}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full whitespace-nowrap tabular-nums">
          <thead>
            <tr>
              <th className={cn(th, 'text-left')}>Car</th>
              <th className={cn(th, 'text-left')}>Now</th>
              <th
                className={cn(th, 'text-right')}
                title="Their push lap starts this much after his (+) or before (−), leaving now"
              >
                Push vs his
              </th>
            </tr>
          </thead>
          <tbody>
            {near.map(({ car, gap }) => (
              <tr key={car.driver}>
                <td className="px-1.5 py-[1px] text-left font-semibold">
                  <span
                    className="mr-1 inline-block h-2.5 w-[3px] align-[-1px]"
                    style={{
                      background: detail.data.drivers.find((d) => d.code === car.driver)?.color,
                    }}
                  />
                  {car.driver}
                </td>
                <td className="px-1.5 py-[1px] text-left text-dim">{KIND_LABEL[car.kind]}</td>
                <td className={cn(td, gap != null && Math.abs(gap) < 2 ? 'text-clip' : 'text-dim')}>
                  {formatGap(gap)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
