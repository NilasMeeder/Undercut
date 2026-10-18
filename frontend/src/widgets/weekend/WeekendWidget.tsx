import { useMemo } from 'react';
import { useLaps, useSessionDetail, useWeekend } from '@/api/queries';
import { DriverCell, PanelMessage, TyreBadge } from '@/components/data/bits';
import { formatGap, formatLapTime } from '@/lib/format';
import { rowStyle, td, th } from '@/lib/table';
import { bestLaps } from '@/lib/timing';
import { cn } from '@/lib/utils';
import { useLapSelection } from '@/store/groups';
import { useSelection } from '@/store/selection';
import type { WidgetProps } from '../types';
import type { WeekendConfig } from './widget';

export function WeekendWidget({ group, config }: WidgetProps<WeekendConfig>) {
  const weekend = useWeekend();
  const detail = useSessionDetail();
  const laps = useLaps();
  const session = useSelection((s) => s.session);
  const { isSelected, toggle } = useLapSelection(group);
  const best = useMemo(() => bestLaps(laps.data ?? []), [laps.data]);

  if (weekend.error) return <PanelMessage>{weekend.error.message}</PanelMessage>;
  if (!weekend.data || !detail.data) return <PanelMessage>Loading the weekend…</PanelMessage>;
  const { sessions } = weekend.data;
  // Only who drives in this session (an FP1 rookie drove someone else's car).
  const here = new Set(detail.data.drivers.map((d) => d.code));
  const drivers = weekend.data.drivers.filter((d) => here.has(d.driver));
  const race = sessions.some((s) => s.race && s.code === 'R');
  const fastestRun = Math.min(...drivers.map((d) => d.long_run?.median ?? Infinity));
  const fastestPace = Math.min(...drivers.map((d) => d.race_pace ?? Infinity));

  return (
    <div className="h-full overflow-auto">
      <table className="w-full whitespace-nowrap text-[11px] tabular-nums">
        <thead>
          <tr>
            <th className={cn(th, 'text-left')}>Drv</th>
            {sessions.map((s) => (
              <th
                key={s.code}
                colSpan={2}
                className={cn(th, 'text-center', s.code === session && 'text-text')}
              >
                {s.code}
              </th>
            ))}
            <th className={cn(th, 'text-right')} colSpan={3} title="Longest run in practice">
              Long run
            </th>
            {race ? (
              <th className={cn(th, 'text-right')} title="Median of the clean race laps">
                Race pace
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {drivers.map((d) => {
            const lap = best.find((l) => l.driver === d.driver);
            const selected = lap != null && isSelected(lap);
            return (
              <tr
                key={d.driver}
                onClick={lap ? () => toggle(lap) : undefined}
                style={rowStyle(selected, group)}
                className={cn('cursor-pointer hover:bg-raised', selected && 'bg-raised')}
              >
                <DriverCell code={d.driver} drivers={detail.data.drivers} />
                {d.cells.map((cell, i) => (
                  <WeekendCells
                    key={sessions[i].code}
                    cell={cell}
                    values={config.values}
                    current={sessions[i].code === session}
                  />
                ))}
                {d.long_run ? (
                  <>
                    <td
                      className={cn(
                        td,
                        d.long_run.median === fastestRun ? 'text-best' : 'text-dim'
                      )}
                    >
                      {formatLapTime(d.long_run.median)}
                    </td>
                    <td className="px-0.5 py-[1px]">
                      <TyreBadge compound={d.long_run.compound} />
                    </td>
                    <td className={cn(td, 'text-faint')}>
                      {d.long_run.laps}×{d.long_run.session}
                    </td>
                  </>
                ) : (
                  <td colSpan={3} />
                )}
                {race ? (
                  <td className={cn(td, d.race_pace === fastestPace ? 'text-best' : 'text-dim')}>
                    {formatLapTime(d.race_pace)}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WeekendCells({
  cell,
  values,
  current,
}: {
  cell: { position: number; best: number | null; gap: number | null } | null;
  values: WeekendConfig['values'];
  current: boolean;
}) {
  if (!cell) return <td colSpan={2} />;
  return (
    <>
      <td
        className={cn(
          td,
          'pr-0',
          current ? 'text-text' : 'text-dim',
          cell.position === 1 && 'text-best'
        )}
      >
        P{cell.position}
      </td>
      <td className={cn(td, 'text-faint')}>
        {values === 'time' ? formatLapTime(cell.best) : cell.gap ? formatGap(cell.gap) : ''}
      </td>
    </>
  );
}
