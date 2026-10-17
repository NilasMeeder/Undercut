import { useMemo } from 'react';
import type { DriverRace, StintPace } from '@/api/client';
import { useDegradation } from '@/api/queries';
import { DriverCell, PanelMessage, TyreBadge } from '@/components/data/bits';
import { COLORS, TYRE_COLORS } from '@/lib/colors';
import { DEFAULT_FUEL, formatDeg, lapAxis, orderAt, statusBands } from '@/lib/strategy';
import { rowStyle, th } from '@/lib/table';
import { cn } from '@/lib/utils';
import type { WidgetProps } from '../types';
import { useGroupDrivers, useStrategyClock, useToggleDriver } from '../useStrategy';
import type { StintsConfig } from './widget';

const pct = (laps: number, total: number) => `${(laps / total) * 100}%`;

function stintTitle(driver: string, s: DriverRace['stints'][number], pace: StintPace | undefined) {
  const set = s.fresh === false ? `used (${(s.start_life ?? 1) - 1} laps old)` : 'new';
  const deg = pace?.fit
    ? `degradation ${formatDeg(pace.fit.slope)} s/lap over ${pace.fit.laps.length} clean laps`
    : 'too few clean laps for a degradation fit';
  return `${driver} stint ${s.number}: ${s.compound ?? '?'} ${set}, laps ${s.start_lap}–${s.end_lap}\n${deg}`;
}

export function StintsWidget({ group, config }: WidgetProps<StintsConfig>) {
  const { history, timeline, drivers, t, until, error } = useStrategyClock();
  const deg = useDegradation(config.deg ? until : undefined, DEFAULT_FUEL);
  const selected = new Set(useGroupDrivers(group));
  const toggle = useToggleDriver(group);

  const paces = useMemo(
    () => new Map((deg.data?.stints ?? []).map((s) => [`${s.driver}:${s.stint}`, s])),
    [deg.data]
  );
  const bands = useMemo(
    () => (history && timeline ? statusBands(history, timeline) : []),
    [history, timeline]
  );

  if (error) return <PanelMessage>{error.message}</PanelMessage>;
  if (!history || !timeline || !drivers) return <PanelMessage>Loading laps…</PanelMessage>;

  const race = history.kind === 'race';
  // Pit losses only mean something in a race; elsewhere a stop is a garage visit.
  const showStops = config.stops && race;
  const total = Math.max(
    history.total_laps ?? 0,
    ...history.drivers.map((d) => d.laps.at(-1) ?? 0)
  );
  const clockLap = t < timeline.end && race ? lapAxis(history, timeline)(t) : null;
  const rows = orderAt(history, t);
  const ticks = Array.from({ length: Math.floor(total / 10) }, (_, i) => (i + 1) * 10);

  return (
    <div className="h-full overflow-auto text-[10px]">
      <table className="w-full table-fixed whitespace-nowrap tabular-nums">
        <colgroup>
          <col className="w-6" />
          <col className="w-12" />
          <col />
          {showStops ? <col className="w-[76px]" /> : null}
        </colgroup>
        <thead>
          <tr>
            <th className={cn(th, 'text-right')}>P</th>
            <th className={cn(th, 'text-left')}>Drv</th>
            <th className={cn(th, 'relative')}>
              {ticks.map((lap) => (
                <span
                  key={lap}
                  className="absolute top-0.5 -translate-x-1/2"
                  style={{ left: pct(lap - 0.5, total) }}
                >
                  {lap}
                </span>
              ))}
              &nbsp;
            </th>
            {showStops ? (
              <th className={cn(th, 'text-right')} title="Time lost per stop (s)">
                Pit
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ driver: d, done }, i) => {
            const lastLap = done > 0 ? d.laps[done - 1] : 0;
            const stops = d.stops.filter((s) => s.lap + 1 <= lastLap);
            const isSelected = selected.has(d.driver);
            return (
              <tr
                key={d.driver}
                onClick={() => toggle(d.driver, t)}
                style={rowStyle(isSelected, group)}
                className={cn('cursor-pointer hover:bg-raised', isSelected && 'bg-raised')}
              >
                <td className="px-1.5 text-right text-faint">{race ? i + 1 : ''}</td>
                <DriverCell code={d.driver} drivers={drivers} />
                <td className="relative h-[18px] p-0">
                  {bands.map((b) => (
                    <span
                      key={`${b.from}`}
                      className="absolute inset-y-0"
                      style={{
                        left: pct(b.from, total),
                        width: pct(b.to - b.from, total),
                        background: b.color,
                        opacity: 0.1,
                      }}
                    />
                  ))}
                  {d.stints.map((s) => {
                    const end = Math.min(s.end_lap, lastLap);
                    if (end < s.start_lap) return null;
                    const color = TYRE_COLORS[s.compound ?? ''] ?? COLORS.textFaint;
                    const pace = paces.get(`${d.driver}:${s.number}`);
                    return (
                      <span
                        key={s.number}
                        title={stintTitle(d.driver, s, pace)}
                        className="absolute inset-y-[2px] flex items-center gap-1 overflow-hidden pl-0.5"
                        style={{
                          left: `calc(${pct(s.start_lap - 1, total)} + 1px)`,
                          width: `calc(${pct(end - s.start_lap + 1, total)} - 2px)`,
                          background: `color-mix(in srgb, ${color} ${s.fresh === false ? 12 : 22}%, transparent)`,
                          borderLeft: `2px solid ${color}`,
                        }}
                      >
                        <TyreBadge compound={s.compound} />
                        <span className="text-text">{end - s.start_lap + 1}</span>
                        {config.deg && pace?.fit ? (
                          <span className="text-dim">{formatDeg(pace.fit.slope)}</span>
                        ) : null}
                      </span>
                    );
                  })}
                  {clockLap != null ? (
                    <span
                      className="absolute inset-y-0 w-px bg-dim"
                      style={{ left: pct(clockLap, total) }}
                    />
                  ) : null}
                </td>
                {showStops ? (
                  <td className="px-1.5 text-right text-dim">
                    {stops.map((s, k) => (
                      <span
                        key={s.lap}
                        title={`L${s.lap}: ${s.loss?.toFixed(1) ?? '?'} s lost, ${s.lane.toFixed(1)} s in the pit lane${s.status !== 'green' ? ` (${s.status.toUpperCase()})` : ''}`}
                        className={cn(s.status !== 'green' && 'text-slow')}
                      >
                        {k > 0 ? ' ' : ''}
                        {s.loss?.toFixed(1) ?? '–'}
                      </span>
                    ))}
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
