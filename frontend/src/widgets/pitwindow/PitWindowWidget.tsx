import type { Duel, PitWindow } from '@/api/client';
import { usePitWindow } from '@/api/queries';
import { DriverCell, PanelMessage, TyreBadge } from '@/components/data/bits';
import { formatGap } from '@/lib/format';
import { TRACK_STATUS_LABEL } from '@/lib/replay';
import { td, th } from '@/lib/table';
import { cn } from '@/lib/utils';
import type { WidgetProps } from '../types';
import { useGroupDrivers, useStrategyClock } from '../useStrategy';
import type { PitWindowConfig } from './widget';

const s = (seconds: number) => Math.abs(seconds).toFixed(2);

/** What the numbers mean for this rival, as one sentence. */
function verdict(window: PitWindow, duel: Duel): { text: string; tone: 'good' | 'bad' | 'none' } {
  const me = window.driver;
  const them = duel.rival;
  if (duel.ahead) {
    const gain = duel.first[0];
    if (gain > duel.gap)
      return {
        text: `Undercut works: stopping a lap before ${them} gains ${s(gain)} s on a ${s(duel.gap)} s gap.`,
        tone: 'good',
      };
    const over = duel.second[0];
    if (over > duel.gap)
      return {
        text: `Overcut works: staying out a lap longer than ${them} gains ${s(over)} s.`,
        tone: 'good',
      };
    const best = Math.max(gain, over);
    return {
      text: `No way past ${them} in the stops: ${best > 0 ? `the best gain is ${s(best)} s` : `${me} loses time either way`}, the gap is ${s(duel.gap)} s.`,
      tone: 'none',
    };
  }
  const threat = -duel.second[0];
  if (threat > duel.gap)
    return {
      text: `${them} gets past by stopping first (${s(threat)} s on a ${s(duel.gap)} s gap): cover by stopping first.`,
      tone: 'bad',
    };
  return {
    text:
      threat > 0
        ? `Safe from ${them}’s undercut by ${s(duel.gap - threat)} s.`
        : `${them} gains nothing by stopping first.`,
    tone: 'none',
  };
}

export function PitWindowWidget({ group, config }: WidgetProps<PitWindowConfig>) {
  const { history, drivers, until, error } = useStrategyClock();
  const driver = useGroupDrivers(group)[0] ?? null;
  const compound = config.compound === 'auto' ? null : config.compound;
  const pit = usePitWindow(history?.kind === 'race' ? driver : null, until, config.fuel, compound);

  if (error) return <PanelMessage>{error.message}</PanelMessage>;
  if (!history || !drivers) return <PanelMessage>Loading laps…</PanelMessage>;
  if (history.kind !== 'race')
    return <PanelMessage>The pit window is for races and sprints.</PanelMessage>;
  if (!driver) return <PanelMessage>Select a driver in this link group.</PanelMessage>;
  if (pit.error && pit.data?.driver !== driver)
    return <PanelMessage>{pit.error.message}</PanelMessage>;
  const w = pit.data;
  if (!w || w.driver !== driver) return <PanelMessage>Calculating…</PanelMessage>;

  const r = w.rejoin;
  const neutralised = ['sc', 'vsc', 'vsc_ending', 'red'].includes(w.status);
  return (
    <div className="h-full overflow-auto text-[11px] tabular-nums">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line px-1.5 py-1">
        <span className="font-semibold">
          {w.driver} P{w.position}
        </span>
        <span className="text-dim">L{w.lap}</span>
        <span className="inline-flex items-center gap-1">
          <TyreBadge compound={w.compound} />
          <span className="text-dim">{w.life ?? '?'} laps</span>
          <span className="text-faint">→</span>
          <TyreBadge compound={w.new_compound} />
        </span>
        <span className={cn('ml-auto', neutralised ? 'text-slow' : 'text-dim')}>
          Pit loss {w.pit_loss.toFixed(1)} s
          {neutralised ? ` (${TRACK_STATUS_LABEL[w.status]})` : ''}
        </span>
      </div>
      {r ? (
        <div className="border-b border-line px-1.5 py-1">
          <span className="text-faint">PIT NOW </span>
          <span className="font-semibold">P{r.position}</span>
          {r.ahead ? (
            <span className={cn('ml-2', (r.gap_ahead ?? 9) < 1.5 ? 'text-slow' : 'text-dim')}>
              {s(r.gap_ahead ?? 0)} s behind {r.ahead}
            </span>
          ) : null}
          {r.behind ? (
            <span className="ml-2 text-dim">
              {s(r.gap_behind ?? 0)} s ahead of {r.behind}
            </span>
          ) : null}
        </div>
      ) : null}
      {w.duels.length > 0 ? (
        <table className="w-full whitespace-nowrap">
          <thead>
            <tr>
              <th className={cn(th, 'text-left')} />
              <th className={cn(th, 'text-left')}>Rival</th>
              <th className={cn(th, 'text-right')}>Gap</th>
              <th className={cn(th, 'text-left')}>Tyre</th>
              <th
                className={cn(th, 'text-right')}
                colSpan={3}
                title="You stop next lap, the rival 1, 2 or 3 laps later: seconds you gain"
              >
                Undercut +1 +2 +3
              </th>
              <th
                className={cn(th, 'text-right')}
                colSpan={3}
                title="The rival stops next lap, you 1, 2 or 3 laps later: seconds you gain"
              >
                Overcut +1 +2 +3
              </th>
            </tr>
          </thead>
          <tbody>
            {w.duels.map((d) => (
              <tr key={d.rival}>
                <td className="px-1.5 py-[1px] text-[10px] text-faint">
                  {d.ahead ? 'AHEAD' : 'BEHIND'}
                </td>
                <DriverCell code={d.rival} drivers={drivers} />
                <td className={td}>{d.gap.toFixed(3)}</td>
                <td className="px-1.5 py-[1px]">
                  <span className="inline-flex items-center gap-1">
                    <TyreBadge compound={d.rival_compound} />
                    <span className="text-faint">{d.rival_life ?? ''}</span>
                  </span>
                </td>
                {[...d.first, ...d.second].map((gain, k) => (
                  <td key={k} className={cn(td, k % 3 === 0 ? 'text-text' : 'text-dim')}>
                    {formatGap(gain).replace(/(\.\d\d)\d$/, '$1')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="space-y-0.5 px-1.5 py-1">
        {w.duels.map((d) => {
          const v = verdict(w, d);
          return (
            <div
              key={d.rival}
              className={cn(
                v.tone === 'good' && 'text-text',
                v.tone === 'bad' && 'text-pit',
                v.tone === 'none' && 'text-dim'
              )}
            >
              {v.text}
            </div>
          );
        })}
        {w.notes.map((note) => (
          <div key={note} className="text-[10px] text-faint">
            {note}
          </div>
        ))}
      </div>
    </div>
  );
}
