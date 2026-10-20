import { useMemo } from 'react';
import { useChampionship, useSessionDetail, useTimingState } from '@/api/queries';
import { DriverCell, PanelMessage } from '@/components/data/bits';
import { sessionPoints, standings } from '@/lib/championship';
import { th, td } from '@/lib/table';
import { cn } from '@/lib/utils';
import { useSelection } from '@/store/selection';
import type { WidgetProps } from '../types';
import { useLapsAtClock } from '../useLapsAtClock';
import type { ChampionshipConfig } from './widget';

const fmt = (points: number) => (Number.isInteger(points) ? `${points}` : points.toFixed(1));

export function ChampionshipWidget({ config, setConfig }: WidgetProps<ChampionshipConfig>) {
  const code = useSelection((s) => s.session);
  const race = code === 'R' || code === 'S';
  const championship = useChampionship(race);
  const timing = useTimingState();
  const detail = useSessionDetail();
  const laps = useLapsAtClock('app');

  const fastest = useMemo(() => {
    let best: { driver: string; time: number } | null = null;
    for (const lap of laps.data ?? []) {
      if (lap.lap_time != null && !lap.deleted && (!best || lap.lap_time < best.time)) {
        best = { driver: lap.driver, time: lap.lap_time };
      }
    }
    return best?.driver ?? null;
  }, [laps.data]);

  if (!race) return <PanelMessage>The championship counts races and sprints.</PanelMessage>;
  if (championship.error) return <PanelMessage>{championship.error.message}</PanelMessage>;
  const table = championship.data;
  const rows = timing.data?.rows;
  if (!table || !rows || !detail.data) return <PanelMessage>Loading the standings…</PanelMessage>;

  const points = sessionPoints(rows, table, fastest);
  const leader = rows.find((r) => r.position === 1 && r.status !== 'retired')?.driver;
  const teamOf = new Map(detail.data.drivers.map((d) => [d.code, d.team]));
  const teams = config.table === 'teams';
  const scored = (name: string) =>
    teams
      ? [...points].reduce((sum, [d, p]) => sum + (teamOf.get(d) === name ? p : 0), 0)
      : (points.get(name) ?? 0);
  const won = (name: string) =>
    code === 'R' && leader != null && (teams ? teamOf.get(leader) === name : leader === name);
  const list = standings(teams ? table.teams : table.drivers, scored, won);
  const top = list[0]?.now ?? 0;
  const colorOf = (team: string) => detail.data.drivers.find((d) => d.team === team)?.color;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-1.5 py-0.5 text-[10px] text-faint">
        {(['drivers', 'teams'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setConfig({ table: t })}
            className={
              config.table === t ? 'font-semibold text-text' : 'font-semibold hover:text-dim'
            }
          >
            {t === 'drivers' ? 'DRIVERS' : 'CONSTRUCTORS'}
          </button>
        ))}
        <span className="ml-auto truncate" title={`Before = after ${table.before}`}>
          as it stands · before: after {table.before}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full whitespace-nowrap text-[11px] tabular-nums">
          <thead>
            <tr>
              <th className={cn(th, 'text-right')}>P</th>
              <th className={th} />
              <th className={cn(th, 'text-left')}>{teams ? 'Team' : 'Drv'}</th>
              <th className={cn(th, 'text-right')} title="Points now">
                Pts
              </th>
              <th className={cn(th, 'text-right')} title="Points from this session at the clock">
                +
              </th>
              <th className={cn(th, 'text-right')} title="Behind the leader">
                Gap
              </th>
              <th className={cn(th, 'text-right')} title="Points before this session">
                Before
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const moved = r.was - r.is;
              const gained = r.now - r.before;
              return (
                <tr key={r.name} className="hover:bg-raised">
                  <td className={cn(td, 'text-dim')}>{r.is}</td>
                  <td
                    className={cn(
                      'px-0.5 py-[1px] text-[10px]',
                      moved > 0 ? 'text-pb' : moved < 0 ? 'text-pit' : 'text-faint'
                    )}
                    title={moved !== 0 ? `P${r.was} before this session` : undefined}
                  >
                    {moved > 0 ? `▲${moved}` : moved < 0 ? `▼${-moved}` : ''}
                  </td>
                  {teams ? (
                    <td className="px-1.5 py-[1px] text-left font-semibold">
                      <span
                        className="mr-1.5 inline-block h-2.5 w-[3px] align-[-1px]"
                        style={{ background: colorOf(r.team) }}
                      />
                      {r.name}
                    </td>
                  ) : (
                    <DriverCell code={r.name} drivers={detail.data.drivers} />
                  )}
                  <td className={cn(td, 'font-semibold text-text')}>{fmt(r.now)}</td>
                  <td className={cn(td, gained > 0 ? 'text-text' : 'text-faint')}>
                    {gained > 0 ? `+${fmt(gained)}` : ''}
                  </td>
                  <td className={cn(td, 'text-dim')}>{r.is === 1 ? '' : `−${fmt(top - r.now)}`}</td>
                  <td className={cn(td, 'text-faint')}>{fmt(r.before)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
