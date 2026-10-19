import type { QualiDuel } from '@/api/client';
import { useSeasonQuali } from '@/api/queries';
import { PanelMessage } from '@/components/data/bits';
import { th } from '@/lib/table';
import { cn } from '@/lib/utils';
import { useGroups } from '@/store/groups';
import { useSelection } from '@/store/selection';
import type { WidgetProps } from '../types';
import type { SeasonConfig } from './widget';

const signed = (v: number, digits: number) =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;

/** Where the first three letters say little: United States, São Paulo. */
const SHORT: Record<string, string> = {
  'United States': 'USA',
  'São Paulo': 'BRA',
  'Las Vegas': 'LVG',
};

/** Three letters per round, unique: Australian AUS, Austrian AUT. */
function shortNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const letters = name.replace(/[^A-Za-z]/g, '').toUpperCase();
    let label = SHORT[name] ?? letters.slice(0, 3);
    for (let i = 3; used.has(label) && i < letters.length; i++)
      label = letters.slice(0, 2) + letters[i];
    used.add(label);
    return label;
  });
}

export function SeasonWidget({ group, config }: WidgetProps<SeasonConfig>) {
  const season = useSeasonQuali(config.kind);
  const current = useSelection((s) => s.round);
  if (season.error) return <PanelMessage>{season.error.message}</PanelMessage>;
  if (!season.data) return <PanelMessage>Loading the season’s qualifying…</PanelMessage>;
  const { rounds, pairs, year } = season.data;
  if (rounds.length === 0)
    return (
      <PanelMessage>
        {config.kind === 'SQ' ? 'No sprint qualifying yet this season.' : 'No qualifying yet.'}
      </PanelMessage>
    );
  const pct = config.values === 'pct';
  const short = shortNames(rounds.map((r) => r.name));

  const open = (round: number, duel: QualiDuel, drivers: string[]) => {
    if (duel.a_lap == null || duel.b_lap == null) return;
    useSelection.setState({ year, round, session: config.kind });
    // A new session clears the lap selections (groups.ts); set the laps after that.
    useGroups.getState().setLaps(group, [
      { driver: drivers[0], lap: duel.a_lap },
      { driver: drivers[1], lap: duel.b_lap },
    ]);
  };

  return (
    <div className="h-full overflow-auto">
      <table className="whitespace-nowrap text-[11px] tabular-nums">
        <thead>
          <tr>
            <th className={cn(th, 'text-left')}>Team</th>
            <th className={cn(th, 'text-right')} title="Rounds each was ahead">
              H2H
            </th>
            <th
              className={cn(th, 'text-right')}
              title="Median gap over the season: + = the first driver quicker"
            >
              {pct ? 'Med %' : 'Median'}
            </th>
            {rounds.map((r, i) => (
              <th
                key={r.round}
                title={r.name}
                className={cn(th, 'text-right', r.round === current && 'text-text')}
              >
                {short[i]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pairs.map((p) => {
            const key = `${p.team}-${p.drivers.join('-')}`;
            const median = pct ? p.median_pct : p.median_gap;
            return (
              <tr key={key} className="hover:bg-raised">
                <td className="px-1.5 py-[1px] text-left">
                  <span
                    className="mr-1.5 inline-block h-2.5 w-[3px] align-[-1px]"
                    style={{ background: p.color }}
                  />
                  <span className="font-semibold">{p.drivers[0]}</span>
                  <span className="text-faint"> v </span>
                  <span className="font-semibold text-dim">{p.drivers[1]}</span>
                </td>
                <td className="px-1.5 py-[1px] text-right">
                  {p.ahead[0]}–{p.ahead[1]}
                </td>
                <td className="px-1.5 py-[1px] text-right">
                  {median == null ? '' : signed(median, pct ? 2 : 3)}
                </td>
                {p.duels.map((d, i) => (
                  <DuelCell
                    key={rounds[i].round}
                    duel={d}
                    pct={pct}
                    drivers={p.drivers}
                    current={rounds[i].round === current}
                    onOpen={(duel) => open(rounds[i].round, duel, p.drivers)}
                  />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DuelCell({
  duel,
  pct,
  drivers,
  current,
  onOpen,
}: {
  duel: QualiDuel | null;
  pct: boolean;
  drivers: string[];
  current: boolean;
  onOpen: (duel: QualiDuel) => void;
}) {
  const base = cn('px-1.5 py-[1px] text-right', current && 'bg-raised');
  if (!duel) return <td className={base} />;
  const value = pct ? duel.pct : duel.gap;
  const ahead = duel.ahead == null ? null : drivers[duel.ahead];
  const title = [
    duel.segment,
    duel.a != null ? `${drivers[0]} ${duel.a.toFixed(3)}` : `${drivers[0]} no time`,
    duel.b != null ? `${drivers[1]} ${duel.b.toFixed(3)}` : `${drivers[1]} no time`,
    ahead ? `${ahead} ahead` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <td
      className={cn(
        base,
        duel.a_lap != null && duel.b_lap != null && 'cursor-pointer hover:text-text'
      )}
      title={`${title}. Click to compare the laps.`}
      onClick={() => onOpen(duel)}
    >
      {value == null ? (
        <span className="text-faint">·</span>
      ) : (
        <span className={value < 0 ? 'text-dim' : undefined}>{signed(value, 2)}</span>
      )}
    </td>
  );
}
