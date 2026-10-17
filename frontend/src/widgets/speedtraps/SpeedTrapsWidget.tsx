import { useMemo } from 'react';
import type { Lap } from '@/api/client';
import { useLaps, useSessionDetail } from '@/api/queries';
import { DriverCell, PanelMessage } from '@/components/data/bits';
import { rowStyle, td, th } from '@/lib/table';
import { bestLaps } from '@/lib/timing';
import { cn } from '@/lib/utils';
import { useLapSelection } from '@/store/groups';
import type { WidgetProps } from '../types';
import type { SpeedTrapsConfig, Trap } from './widget';

const TRAPS: { key: Trap; label: string }[] = [
  { key: 'speed_i1', label: 'I1' },
  { key: 'speed_i2', label: 'I2' },
  { key: 'speed_finish', label: 'FL' },
  { key: 'speed_trap', label: 'ST' },
];

/** Per driver and trap: the speed and the lap it was set on. */
type Row = { driver: string; speeds: Record<Trap, Lap | null> };

function buildRows(laps: Lap[], source: SpeedTrapsConfig['source']): Row[] {
  const rows = new Map<string, Row>();
  const candidates =
    source === 'best' ? bestLaps(laps) : laps.filter((l) => !l.pit_in && !l.pit_out);
  for (const lap of candidates) {
    let row = rows.get(lap.driver);
    if (!row) {
      row = {
        driver: lap.driver,
        speeds: { speed_i1: null, speed_i2: null, speed_finish: null, speed_trap: null },
      };
      rows.set(lap.driver, row);
    }
    for (const { key } of TRAPS) {
      const value = lap[key];
      const current = row.speeds[key]?.[key];
      if (value != null && (current == null || value > current)) row.speeds[key] = lap;
    }
  }
  return [...rows.values()];
}

export function SpeedTrapsWidget({ group, config }: WidgetProps<SpeedTrapsConfig>) {
  const laps = useLaps();
  const detail = useSessionDetail();
  const { isSelected, toggle } = useLapSelection(group);

  const rows = useMemo(() => {
    const built = buildRows(laps.data ?? [], config.source);
    const speed = (r: Row) => r.speeds[config.sort]?.[config.sort] ?? -Infinity;
    return built.sort((a, b) => speed(b) - speed(a));
  }, [laps.data, config.source, config.sort]);

  if (laps.error) return <PanelMessage>{laps.error.message}</PanelMessage>;
  if (!laps.data || !detail.data) return <PanelMessage>Loading laps…</PanelMessage>;
  if (rows.length === 0) return <PanelMessage>No speed-trap data in this session.</PanelMessage>;

  const top = Object.fromEntries(
    TRAPS.map(({ key }) => [key, Math.max(...rows.map((r) => r.speeds[key]?.[key] ?? -Infinity))])
  ) as Record<Trap, number>;

  return (
    <div className="h-full overflow-auto">
      <table className="w-full whitespace-nowrap text-[11px]">
        <thead>
          <tr>
            <th className={cn(th, 'text-right')}>P</th>
            <th className={cn(th, 'text-left')}>Drv</th>
            {TRAPS.map(({ key, label }) => (
              <th key={key} className={cn(th, 'text-right', key === config.sort && 'text-text')}>
                {label}
              </th>
            ))}
            <th className={cn(th, 'text-right')}>Δ</th>
            <th className={cn(th, 'text-right')}>Lap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const source = row.speeds[config.sort];
            const value = source?.[config.sort];
            const selected = source != null && isSelected(source);
            return (
              <tr
                key={row.driver}
                onClick={() => source && toggle(source)}
                style={rowStyle(selected, group)}
                className={cn('cursor-pointer hover:bg-raised', selected && 'bg-raised')}
              >
                <td className={cn(td, 'text-faint')}>{i + 1}</td>
                <DriverCell code={row.driver} drivers={detail.data.drivers} />
                {TRAPS.map(({ key }) => {
                  const speed = row.speeds[key]?.[key];
                  return (
                    <td
                      key={key}
                      className={cn(td, speed === top[key] ? 'text-best' : 'text-text')}
                      title={row.speeds[key] ? `Lap ${row.speeds[key].lap}` : undefined}
                    >
                      {speed?.toFixed(0) ?? ''}
                    </td>
                  );
                })}
                <td className={cn(td, 'text-dim')}>
                  {value != null && value !== top[config.sort]
                    ? `−${(top[config.sort] - value).toFixed(0)}`
                    : ''}
                </td>
                <td className={cn(td, 'text-faint')}>{source?.lap ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
