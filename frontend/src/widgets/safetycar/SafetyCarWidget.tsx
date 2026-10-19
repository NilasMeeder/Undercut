import { useMemo } from 'react';
import { usePitCalculator } from '@/api/queries';
import { DriverCell, PanelMessage, TyreBadge } from '@/components/data/bits';
import { formatGap } from '@/lib/format';
import { td, th } from '@/lib/table';
import { cn } from '@/lib/utils';
import type { WidgetProps } from '../types';
import { useStrategyClock } from '../useStrategy';
import type { SafetyCarConfig } from './widget';

export function SafetyCarWidget({ config }: WidgetProps<SafetyCarConfig>) {
  const { history, timeline, drivers, until, t, error } = useStrategyClock();
  const race = history?.kind === 'race';
  const now = timeline?.track_status.find((p) => p.start <= t && t < p.end)?.status;
  const live = now === 'sc' || now === 'vsc' || now === 'vsc_ending';
  const status =
    config.status !== 'auto' ? config.status : now === 'vsc' || now === 'vsc_ending' ? 'vsc' : 'sc';
  const calc = usePitCalculator(until, status, race);
  const green = usePitCalculator(until, 'green', race);
  const greenAt = useMemo(
    () => new Map(green.data?.rows.map((r) => [r.driver, r.rejoin?.position ?? null])),
    [green.data]
  );

  if (error) return <PanelMessage>{error.message}</PanelMessage>;
  if (!history || !drivers) return <PanelMessage>Loading laps…</PanelMessage>;
  if (!race)
    return <PanelMessage>The safety car calculator is for races and sprints.</PanelMessage>;
  if (calc.error && !calc.data) return <PanelMessage>{calc.error.message}</PanelMessage>;
  const c = calc.data;
  if (!c) return <PanelMessage>Calculating…</PanelMessage>;

  const name = c.status === 'vsc' ? 'VSC' : 'SAFETY CAR';
  return (
    <div className="h-full overflow-auto text-[11px] tabular-nums">
      <div className="flex items-center gap-3 border-b border-line px-1.5 py-0.5">
        <span className={cn('font-semibold', live ? 'text-slow' : 'text-dim')}>
          {live ? name : `IF ${name} NOW`}
        </span>
        <span className="text-dim">L{c.lap}</span>
        <span className="ml-auto text-faint">
          pit loss {c.loss.toFixed(1)} s · green {c.green_loss.toFixed(1)} s · saves{' '}
          {(c.green_loss - c.loss).toFixed(1)} s
        </span>
      </div>
      <table className="w-full whitespace-nowrap">
        <thead>
          <tr>
            <th className={cn(th, 'text-right')}>P</th>
            <th className={cn(th, 'text-left')}>Driver</th>
            <th className={cn(th, 'text-left')}>Tyre</th>
            <th className={cn(th, 'text-left')} title="One dry compound so far: a stop is owed">
              Owes
            </th>
            <th className={cn(th, 'text-right')} title="Rejoin if he alone stops now">
              {c.status === 'vsc' ? 'VSC' : 'SC'} P
            </th>
            <th className={cn(th, 'text-right')}>±</th>
            <th className={cn(th, 'text-right')} title="The same stop under green">
              Green P
            </th>
            <th className={cn(th, 'text-left')}>Behind</th>
            <th className={cn(th, 'text-left')}>Ahead of</th>
          </tr>
        </thead>
        <tbody>
          {c.rows.map((r) => {
            const rj = r.rejoin;
            const greenP = greenAt.get(r.driver) ?? null;
            return (
              <tr key={r.driver}>
                <td className={td}>{r.position}</td>
                <td className="px-1.5 py-[1px]">
                  <DriverCell code={r.driver} drivers={drivers} />
                </td>
                <td className="px-1.5 py-[1px]">
                  <span className="inline-flex items-center gap-1">
                    <TyreBadge compound={r.compound} />
                    <span className="text-dim">{r.life ?? ''}</span>
                  </span>
                </td>
                <td className="px-1.5 py-[1px] text-[10px] font-semibold text-dim">
                  {r.in_pit ? <span className="text-pit">IN PIT</span> : r.owes_stop ? 'STOP' : ''}
                </td>
                <td className={cn(td, 'font-semibold')}>{rj ? rj.position : '–'}</td>
                <td
                  className={cn(
                    td,
                    r.places === 0 ? 'text-pb' : r.places != null ? 'text-dim' : 'text-faint'
                  )}
                >
                  {r.places == null ? '' : r.places === 0 ? 'FREE' : `−${r.places}`}
                </td>
                <td className={cn(td, 'text-faint')}>{greenP ?? ''}</td>
                <td className="px-1.5 py-[1px] text-dim">
                  {rj?.ahead ? `${rj.ahead} ${formatGap(rj.gap_ahead)}` : ''}
                </td>
                <td className="px-1.5 py-[1px] text-dim">
                  {rj?.behind ? `${rj.behind} ${formatGap(rj.gap_behind).slice(1)}` : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
