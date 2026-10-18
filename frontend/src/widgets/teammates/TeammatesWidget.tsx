import { useSessionDetail, useTeammates } from '@/api/queries';
import { PanelMessage } from '@/components/data/bits';
import { formatGap } from '@/lib/format';
import { rowStyle, td, th } from '@/lib/table';
import { cn } from '@/lib/utils';
import { useGroupLaps, useGroups } from '@/store/groups';
import type { WidgetProps } from '../types';
import type { TeammatesConfig } from './widget';

/** Times: the second driver behind (+) is dim, ahead (−) green. Speeds (`faster`): higher is
 * better, so a positive difference is green. */
function GapCell({ value, speed = false }: { value: number | null; speed?: boolean }) {
  if (value == null) return <td className={td} />;
  const better = speed ? value > 0 : value < 0;
  const text = speed
    ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(0)}`
    : formatGap(value);
  return <td className={cn(td, better ? 'text-pb' : 'text-dim')}>{text}</td>;
}

export function TeammatesWidget({ group, config }: WidgetProps<TeammatesConfig>) {
  const teammates = useTeammates();
  const detail = useSessionDetail();
  const selected = useGroupLaps(group);
  const setLaps = useGroups((s) => s.setLaps);

  if (teammates.error) return <PanelMessage>{teammates.error.message}</PanelMessage>;
  if (!teammates.data || !detail.data) return <PanelMessage>Loading best laps…</PanelMessage>;
  const { race, teams } = teammates.data;
  if (teams.length === 0) return <PanelMessage>No teams with two drivers here.</PanelMessage>;

  const colorOf = (code: string) => detail.data.drivers.find((d) => d.code === code)?.color;

  return (
    <div className="h-full overflow-auto">
      <table className="w-full whitespace-nowrap text-[11px] tabular-nums">
        <thead>
          <tr>
            <th className={cn(th, 'text-left')}>Drivers</th>
            <th className={cn(th, 'text-right')} title="Best lap: second minus first">
              Gap
            </th>
            <th className={cn(th, 'text-right')}>S1</th>
            <th className={cn(th, 'text-right')}>S2</th>
            <th className={cn(th, 'text-right')}>S3</th>
            <th className={cn(th, 'text-right')} title="Top speed, km/h">
              Top
            </th>
            <th className={cn(th, 'text-left')}>Where</th>
            {race ? (
              <th
                className={cn(th, 'text-right')}
                title="Median of the clean laps: second minus first"
              >
                Pace
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {teams.map((pair) => {
            const refs = pair.drivers.flatMap((driver, i) => {
              const lap = pair.laps[i];
              return lap != null ? [{ driver, lap }] : [];
            });
            const isSelected =
              refs.length > 0 &&
              refs.every((r) => selected.some((s) => s.driver === r.driver && s.lap === r.lap));
            const worst = [...pair.corners]
              .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
              .slice(0, config.corners);
            const [paceA, paceB] = pair.pace;
            return (
              <tr
                key={pair.team}
                title={pair.team}
                onClick={refs.length > 0 ? () => setLaps(group, refs) : undefined}
                style={rowStyle(isSelected, group)}
                className={cn('cursor-pointer hover:bg-raised', isSelected && 'bg-raised')}
              >
                <td className="px-1.5 py-[1px] text-left font-semibold">
                  {pair.drivers.map((code, i) => (
                    <span key={code} className={i === 1 ? 'text-dim' : ''}>
                      {i === 1 ? <span className="px-1 font-normal text-faint">vs</span> : null}
                      <span
                        className="mr-1 inline-block h-2.5 w-[3px] align-[-1px]"
                        style={{ background: colorOf(code) }}
                      />
                      {code}
                    </span>
                  ))}
                </td>
                <GapCell value={pair.gap} />
                {pair.sectors.map((s, i) => (
                  <GapCell key={i} value={s} />
                ))}
                <GapCell value={pair.top_speed} speed />
                <td className="px-1.5 py-[1px] text-left text-dim">
                  {worst.map((c) => (
                    <span key={c.label} className="mr-2">
                      {c.label}{' '}
                      <span className={c.gap < 0 ? 'text-pb' : ''}>{formatGap(c.gap)}</span>
                    </span>
                  ))}
                </td>
                {race ? (
                  <td
                    className={cn(td, 'text-dim')}
                    title={`${pair.pace_laps[0]} and ${pair.pace_laps[1]} clean laps`}
                  >
                    {paceA != null && paceB != null ? formatGap(paceB - paceA) : ''}
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
