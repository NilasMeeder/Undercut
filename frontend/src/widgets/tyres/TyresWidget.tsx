import { useMemo } from 'react';
import type { TyreSet } from '@/api/client';
import { useLaps, useSessionDetail, useTyreSets } from '@/api/queries';
import { DriverCell, PanelMessage, TyreBadge } from '@/components/data/bits';
import { rowStyle, td, th } from '@/lib/table';
import { bestLaps } from '@/lib/timing';
import { cn } from '@/lib/utils';
import { useLapSelection } from '@/store/groups';
import { useSelection } from '@/store/selection';
import type { WidgetProps } from '../types';
import type { TyresConfig } from './widget';

const COMPOUNDS = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'];
const SHORT: Record<string, string> = {
  SOFT: 'S',
  MEDIUM: 'M',
  HARD: 'H',
  INTERMEDIATE: 'I',
  WET: 'W',
};

function describe(set: TyreSet): string {
  const origin = set.new_in ? `New in ${set.new_in}` : 'Used before the data';
  const uses = set.uses.map((u) => `${u.session} ${u.laps} laps (age ${u.first}–${u.last})`);
  return [`${set.compound}: ${origin}, ${set.life} laps old`, ...uses].join('\n');
}

export function TyresWidget({ group, config }: WidgetProps<TyresConfig>) {
  const tyres = useTyreSets();
  const laps = useLaps();
  const detail = useSessionDetail();
  const session = useSelection((s) => s.session);
  const { isSelected, toggle } = useLapSelection(group);

  const best = useMemo(() => bestLaps(laps.data ?? []), [laps.data]);
  const rows = useMemo(() => {
    // Only who drives in this session: an FP1 rookie's sets count for the car, not for him.
    const here = new Set((detail.data?.drivers ?? []).map((d) => d.code));
    const drivers = (tyres.data?.drivers ?? []).filter((d) => here.has(d.driver));
    if (config.order === 'driver') return drivers;
    const rank = new Map(best.map((lap, i) => [lap.driver, i]));
    return [...drivers].sort((a, b) => (rank.get(a.driver) ?? 99) - (rank.get(b.driver) ?? 99));
  }, [tyres.data, detail.data, best, config.order]);

  if (tyres.error) return <PanelMessage>{tyres.error.message}</PanelMessage>;
  if (!tyres.data || !detail.data) return <PanelMessage>Loading tyres…</PanelMessage>;
  if (rows.length === 0) return <PanelMessage>No tyre data this weekend.</PanelMessage>;

  const used = COMPOUNDS.filter((c) => rows.some((r) => r.sets.some((s) => s.compound === c)));

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-baseline gap-3 border-b border-line px-1.5 py-0.5 text-[11px]">
        <span className="text-[10px] font-medium uppercase text-faint">Weekend</span>
        <span className="text-dim">{tyres.data.sessions.join(' · ')}</span>
        {tyres.data.missing.length > 0 ? (
          <span className="text-faint">no data: {tyres.data.missing.join(', ')}</span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full whitespace-nowrap text-[11px] tabular-nums">
          <thead>
            <tr>
              <th className={cn(th, 'text-left')}>Drv</th>
              <th className={cn(th, 'text-left')}>Sets (age in laps)</th>
              {used.map((c) => (
                <th key={c} className={cn(th, 'text-right')} title={`${c} sets used`}>
                  {SHORT[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const lap = best.find((l) => l.driver === row.driver);
              const selected = lap != null && isSelected(lap);
              return (
                <tr
                  key={row.driver}
                  onClick={lap ? () => toggle(lap) : undefined}
                  style={rowStyle(selected, group)}
                  className={cn('cursor-pointer hover:bg-raised', selected && 'bg-raised')}
                >
                  <DriverCell code={row.driver} drivers={detail.data.drivers} />
                  <td className="px-1.5 py-[1px]">
                    <span className="flex gap-1.5">
                      {row.sets.map((set, i) => (
                        <span
                          key={i}
                          title={describe(set)}
                          className={cn(
                            'inline-flex items-center gap-0.5',
                            set.uses.some((u) => u.session === session) ? '' : 'opacity-40'
                          )}
                        >
                          <TyreBadge compound={set.compound} />
                          <span className="text-dim">{set.life}</span>
                          {set.new_in == null ? <span className="text-faint">·</span> : null}
                        </span>
                      ))}
                    </span>
                  </td>
                  {used.map((c) => (
                    <td key={c} className={cn(td, 'text-dim')}>
                      {row.sets.filter((s) => s.compound === c).length || ''}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
