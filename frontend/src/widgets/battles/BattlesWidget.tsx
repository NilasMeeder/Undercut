import { useMemo } from 'react';
import { PanelMessage } from '@/components/data/bits';
import { battles, ATTACK } from '@/lib/battles';
import { formatGap, formatLapTime } from '@/lib/format';
import { latestLap } from '@/lib/strategy';
import { rowStyle, td, th } from '@/lib/table';
import { cn } from '@/lib/utils';
import { useGroups } from '@/store/groups';
import type { WidgetProps } from '../types';
import { crossingsKey, useGroupDrivers, useStrategyClock } from '../useStrategy';
import type { BattlesConfig } from './widget';

/** "in 4" laps; red when it happens before the flag. */
function LapsCell({ laps, left }: { laps: number | null; left: number | null }) {
  if (laps == null) return <td className={td} />;
  const soon = left == null || laps <= left;
  return (
    <td className={cn(td, laps === 0 ? 'text-pit' : soon ? 'text-text' : 'text-faint')}>
      {laps === 0 ? 'NOW' : laps}
    </td>
  );
}

export function BattlesWidget({ group, config }: WidgetProps<BattlesConfig>) {
  const { history, drivers, t, error } = useStrategyClock();
  const selected = useGroupDrivers(group);
  const setLaps = useGroups((s) => s.setLaps);
  const crossings = crossingsKey(history, t);

  const rows = useMemo(
    () => (history && history.kind === 'race' ? battles(history, t, config.window) : []),
    // Recomputed per line crossing, not per clock tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, crossings, config.window]
  );

  if (error) return <PanelMessage>{error.message}</PanelMessage>;
  if (!history || !drivers) return <PanelMessage>Loading race…</PanelMessage>;
  if (history.kind !== 'race') return <PanelMessage>Battles are for races.</PanelMessage>;

  const picked = new Set(selected);
  const shown = rows.filter((b) => {
    if (config.show === 'selected')
      return picked.has(b.ahead.driver) || picked.has(b.behind.driver);
    if (config.show === 'close')
      return (b.interval != null && b.interval < 3) || (b.trend != null && b.trend > 0.1);
    return true;
  });
  const colorOf = (code: string) => drivers.find((d) => d.code === code)?.color;
  const name = (code: string) => (
    <>
      <span
        className="mr-1 inline-block h-2.5 w-[3px] align-[-1px]"
        style={{ background: colorOf(code) }}
      />
      {code}
    </>
  );

  return (
    <div className="h-full overflow-auto">
      <table className="w-full whitespace-nowrap text-[11px] tabular-nums">
        <thead>
          <tr>
            <th className={cn(th, 'text-right')}>P</th>
            <th className={cn(th, 'text-left')}>Behind</th>
            <th className={cn(th, 'text-left')}>Ahead</th>
            <th className={cn(th, 'text-right')} title="At the line of the last lap both completed">
              Int
            </th>
            <th className={cn(th, 'text-right')} title="Seconds per lap the car behind gains">
              Trend
            </th>
            <th className={cn(th, 'text-right')} title="Mean clean lap, car behind">
              Pace
            </th>
            <th className={cn(th, 'text-right')} title="Mean clean lap, car ahead">
              Ahead
            </th>
            <th className={cn(th, 'text-right')} title={`Laps until within ${ATTACK} s`}>
              Attack
            </th>
            <th className={cn(th, 'text-right')} title="Laps until on the car ahead">
              Catch
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((b) => {
            const isSelected = picked.has(b.behind.driver) || picked.has(b.ahead.driver);
            return (
              <tr
                key={b.behind.driver}
                onClick={() =>
                  setLaps(group, [
                    { driver: b.behind.driver, lap: latestLap(b.behind, t) },
                    { driver: b.ahead.driver, lap: latestLap(b.ahead, t) },
                  ])
                }
                style={rowStyle(isSelected, group)}
                className={cn('cursor-pointer hover:bg-raised', isSelected && 'bg-raised')}
              >
                <td className={cn(td, 'text-faint')}>{b.position}</td>
                <td className="px-1.5 py-[1px] text-left font-semibold">{name(b.behind.driver)}</td>
                <td className="px-1.5 py-[1px] text-left text-dim">{name(b.ahead.driver)}</td>
                <td
                  className={cn(
                    td,
                    b.interval != null && b.interval <= ATTACK ? 'text-pit' : 'text-text'
                  )}
                >
                  {b.interval == null ? '–' : formatGap(b.interval).replace('+', '')}
                </td>
                <td
                  className={cn(
                    td,
                    b.trend == null ? 'text-faint' : b.trend > 0 ? 'text-pb' : 'text-dim'
                  )}
                >
                  {b.trend == null ? '–' : formatGap(b.trend)}
                </td>
                <td className={cn(td, 'text-dim')}>{formatLapTime(b.pace[1])}</td>
                <td className={cn(td, 'text-faint')}>{formatLapTime(b.pace[0])}</td>
                <LapsCell laps={b.attackIn} left={b.lapsLeft} />
                <LapsCell laps={b.catchIn} left={b.lapsLeft} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
