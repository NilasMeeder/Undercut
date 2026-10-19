import { useMemo } from 'react';
import type {
  EnergyComparison,
  EnergySession,
  EnergyStraight,
  EnergyStraightStats,
} from '@/api/client';
import { useEnergy, useEnergySession, useLaps, useSessionDetail } from '@/api/queries';
import { DriverCell, LineSwatch, NoLapsMessage, PanelMessage } from '@/components/data/bits';
import {
  compareLaps,
  ENERGY_LEVEL,
  explainDownshifts,
  explainLap,
  straightLabel,
} from '@/lib/energy';
import { rowStyle, td, th } from '@/lib/table';
import { bestLaps, lapStyles, type LapStyle } from '@/lib/timing';
import { cn } from '@/lib/utils';
import { cursorBus, useZoom, type Range } from '@/store/cursor';
import { useGroupLaps, useLapSelection, type GroupId } from '@/store/groups';
import type { WidgetProps } from '../types';
import type { EnergyConfig } from './widget';

export function EnergyWidget({ group, config, setConfig }: WidgetProps<EnergyConfig>) {
  const detail = useSessionDetail();
  const session = useEnergySession(config.view === 'session');
  const laps = useGroupLaps(group);
  const energy = useEnergy(laps, config.view === 'laps');
  const clean = config.view === 'laps' ? energy.data?.clean_laps : session.data?.clean_laps;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-line px-1 py-0.5">
        {(['laps', 'session'] as const).map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => setConfig({ view })}
            className={cn(
              'px-1.5 py-0.5 text-[10px] font-semibold uppercase',
              config.view === view ? 'bg-raised text-text' : 'text-faint hover:text-dim'
            )}
          >
            {view}
          </button>
        ))}
        <span className="ml-auto pr-1 text-[10px] text-faint">
          {clean != null ? `Estimate from ${clean} clean laps` : ''}
        </span>
      </div>
      {detail.data?.has_drs ? (
        <div className="shrink-0 border-b border-line px-1.5 py-0.5 text-[10px] text-faint">
          Made for 2026 cars. Before 2026 DRS and drag limit the top speed too: read with care.
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {config.view === 'laps' ? (
          laps.length === 0 ? (
            <NoLapsMessage group={group} />
          ) : energy.error ? (
            <PanelMessage>{energy.error.message}</PanelMessage>
          ) : !energy.data ? (
            <PanelMessage>Reading the session’s clean laps…</PanelMessage>
          ) : (
            <LapsTable group={group} data={energy.data} fetching={energy.isFetching} />
          )
        ) : session.error ? (
          <PanelMessage>{session.error.message}</PanelMessage>
        ) : !session.data ? (
          <PanelMessage>Reading the session’s clean laps…</PanelMessage>
        ) : (
          <SessionTable group={group} data={session.data} metric={config.metric} />
        )}
      </div>
    </div>
  );
}

/** "VER" when every lap is another driver's, "VER L12" otherwise. */
function lapNames(laps: { driver: string; lap: number }[]): string[] {
  const distinct = new Set(laps.map((l) => l.driver)).size === laps.length;
  return laps.map((l) => (distinct ? l.driver : `${l.driver} L${l.lap}`));
}

function seconds(value: number): string {
  return value < 0.0005 ? '' : `+${value.toFixed(3)}`;
}

function sessionLine(stats: EnergyStraightStats): string {
  if (stats.clipping === 0) return 'session: no clipping';
  const losing =
    stats.superclipping > 0
      ? `, ${Math.round(stats.superclipping * 100)}% lose speed` +
        (stats.lost > 0 ? ` (−${stats.lost.toFixed(0)} km/h)` : '')
      : '';
  return (
    `session: ${Math.round(stats.clipping * 100)}% clip, median ${stats.clipped} m, ` +
    `${stats.cost_time.toFixed(3)} s${losing} · top ${stats.peak_speed.toFixed(0)}`
  );
}

function LapsTable({
  group,
  data,
  fetching,
}: {
  group: GroupId;
  data: EnergyComparison;
  fetching: boolean;
}) {
  const detail = useSessionDetail();
  const zoom = useZoom(group);
  const styles: LapStyle[] = useMemo(
    () => lapStyles(data.laps, detail.data?.drivers),
    [data.laps, detail.data]
  );
  const names = useMemo(() => lapNames(data.laps), [data.laps]);
  const lines = useMemo(() => {
    const [ref, ...rest] = data.laps;
    if (!ref) return [];
    const out = data.laps.slice(0, 3).map((lap, i) => explainLap(names[i], lap, data.straights));
    rest.slice(0, 2).forEach((lap, i) => {
      const line = compareLaps(names[0], ref, names[i + 1], lap, data.straights);
      if (line) out.push(line);
    });
    data.laps.slice(0, 3).forEach((lap, i) => {
      const line = explainDownshifts(names[i], lap, data.straights);
      if (line) out.push(line);
    });
    return out;
  }, [data, names]);
  const coasting = data.laps.some((l) => l.straights.some((s) => (s?.coast ?? 0) > 0));
  const shifting = data.laps.some((l) => l.straights.some((s) => (s?.downshifts.length ?? 0) > 0));
  const losing = data.laps.some((l) => l.straights.some((s) => s?.superclip != null));
  const extra = (coasting ? 1 : 0) + (shifting ? 1 : 0) + (losing ? 1 : 0);

  if (data.straights.length === 0)
    return <PanelMessage>No straights found in this session.</PanelMessage>;

  return (
    <div className={fetching ? 'opacity-60' : undefined}>
      <ul className="space-y-0.5 border-b border-line px-1.5 py-1 text-[11px] leading-snug text-dim">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <table className="w-full whitespace-nowrap text-[11px]">
        <thead>
          <tr>
            <th className={cn(th, 'text-left')}>Straight</th>
            <th className={cn(th, 'text-right')} title="Top speed on the straight (km/h)">
              Top
            </th>
            <th className={cn(th, 'text-right')} title="Speed where full throttle ends (km/h)">
              End
            </th>
            <th
              className={cn(th, 'text-right')}
              title="Metres at full throttle without gaining, from where the car itself stops gaining (when the best laps still gained there, or it goes on to lose speed)"
            >
              Clip m
            </th>
            <th className={cn(th, 'text-right')} title="Time clipping cost up to the lift/brake">
              Cost s
            </th>
            <th
              className={cn(th, 'text-right')}
              title="km/h more at the lift/brake, accelerating like the best laps"
            >
              km/h
            </th>
            {losing ? (
              <th
                className={cn(th, 'text-right')}
                title="Superclipping: km/h lost at full throttle after the clip point (harvesting while flat; in one gear the rpm falls with it)"
              >
                Lost
              </th>
            ) : null}
            {coasting ? (
              <th
                className={cn(th, 'text-right')}
                title="Lift and coast: metres from lift to brake"
              >
                Lift m
              </th>
            ) : null}
            {shifting ? (
              <th
                className={cn(th, 'text-right')}
                title="Downshift at full throttle above 200 km/h: the gear it goes to (keeps the engine above 10,500 rpm while harvesting)"
              >
                Down
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {data.straights.map((straight, si) => (
            <StraightRows
              key={straight.corner}
              group={group}
              straight={straight}
              index={si}
              data={data}
              names={names}
              styles={styles}
              coasting={coasting}
              shifting={shifting}
              losing={losing}
              zoom={zoom}
            />
          ))}
          <tr className="border-t border-line">
            <td className="px-1.5 pt-1 text-left text-[10px] uppercase text-faint" colSpan={3}>
              Lap
            </td>
            <td colSpan={3 + extra} />
          </tr>
          {data.laps.map((lap, i) => (
            <tr key={`${lap.driver}-${lap.lap}`}>
              <td className="flex items-center gap-1.5 px-1.5 py-[1px]" colSpan={3}>
                <LineSwatch color={styles[i].color} dash={styles[i].dash} />
                {lap.driver} <span className="text-faint">L{lap.lap}</span>
              </td>
              <td className={td}>{lap.clipped > 0 ? lap.clipped : ''}</td>
              <td className={cn(td, 'font-semibold')}>{seconds(lap.cost_time)}</td>
              <td colSpan={1 + extra} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StraightRows({
  group,
  straight,
  index,
  data,
  names,
  styles,
  coasting,
  shifting,
  losing,
  zoom,
}: {
  group: GroupId;
  straight: EnergyStraight;
  index: number;
  data: EnergyComparison;
  names: string[];
  styles: LapStyle[];
  coasting: boolean;
  shifting: boolean;
  losing: boolean;
  zoom: Range | null;
}) {
  const rows = data.laps.map((lap) => lap.straights[index]);
  const present = rows.filter((r) => r != null);
  const range: [number, number] | null =
    present.length > 0
      ? [
          Math.max(Math.min(...present.map((r) => r.start)), 0),
          Math.max(...present.map((r) => r.end + r.coast)) + 150,
        ]
      : null;
  const extra = (coasting ? 1 : 0) + (shifting ? 1 : 0) + (losing ? 1 : 0);
  const zoomed = range != null && zoom != null && zoom[0] === range[0] && zoom[1] === range[1];
  return (
    <>
      <tr
        onClick={() =>
          range && cursorBus.setZoom(group, zoomed ? null : range, undefined, 'energy')
        }
        className={cn('cursor-pointer border-t border-line hover:bg-raised', zoomed && 'bg-raised')}
      >
        <td className="px-1.5 pt-0.5 text-left font-semibold">{straightLabel(straight)}</td>
        <td className="px-1.5 pt-0.5 text-left text-[10px] text-faint" colSpan={5 + extra}>
          {sessionLine(straight.session)}
        </td>
      </tr>
      {rows.map((row, i) => {
        const lap = data.laps[i];
        const clipping = row?.clip_at != null;
        return (
          <tr
            key={`${lap.driver}-${lap.lap}`}
            onMouseEnter={() =>
              row && cursorBus.setCursor(group, Math.max(row.clip_at ?? row.end, 0))
            }
            onMouseLeave={() => cursorBus.setCursor(group, null)}
            className="hover:bg-raised"
          >
            <td className="flex items-center gap-1.5 py-[1px] pl-3 pr-1.5">
              <LineSwatch color={styles[i].color} dash={styles[i].dash} />
              {names[i]}
            </td>
            {row == null ? (
              <td className={cn(td, 'text-faint')} colSpan={5 + extra}>
                no full-throttle run here
              </td>
            ) : (
              <>
                <td className={td}>{row.peak_speed.toFixed(0)}</td>
                <td className={td}>{row.end_speed.toFixed(0)}</td>
                <td
                  className={cn(td, !clipping && 'text-faint')}
                  title={
                    clipping
                      ? `From ${Math.round(row.clip_at!)} m, ${Math.round(row.end - row.clip_at!)} m before the end of full throttle`
                      : undefined
                  }
                >
                  {clipping ? row.clipped : '–'}
                </td>
                <td className={cn(td, row.cost_time < ENERGY_LEVEL && 'text-faint')}>
                  {seconds(row.cost_time)}
                </td>
                <td className={cn(td, row.cost_time < ENERGY_LEVEL && 'text-faint')}>
                  {clipping ? `+${row.cost_speed.toFixed(0)}` : ''}
                </td>
                {losing ? (
                  <td
                    className={td}
                    title={
                      row.superclip
                        ? `Loses speed at full throttle from ${Math.round(row.superclip.start)} m, ${Math.max(Math.round(row.end - row.superclip.start), 0)} m before the end of full throttle`
                        : undefined
                    }
                  >
                    {row.superclip ? `−${row.lost.toFixed(0)}` : ''}
                  </td>
                ) : null}
                {coasting ? <td className={td}>{row.coast > 0 ? row.coast : ''}</td> : null}
                {shifting ? (
                  <td
                    className={td}
                    title={row.downshifts
                      .map(
                        (d) =>
                          `To ${d.gear}th at ${d.speed.toFixed(0)} km/h, ${Math.max(Math.round(row.end - d.at), 0)} m before the end of full throttle`
                      )
                      .join('\n')}
                  >
                    {row.downshifts.map((d) => d.gear).join(' ')}
                  </td>
                ) : null}
              </>
            )}
          </tr>
        );
      })}
    </>
  );
}

const METRIC_TITLES: Record<EnergyConfig['metric'], string> = {
  cost: 'median cost (s)',
  clipped: 'median metres clipping',
  downshifts: 'share of laps with a downshift at full throttle',
  lost: 'median km/h lost at full throttle (superclipping)',
};

function SessionTable({
  group,
  data,
  metric,
}: {
  group: GroupId;
  data: EnergySession;
  metric: EnergyConfig['metric'];
}) {
  const detail = useSessionDetail();
  const laps = useLaps();
  const selected = useGroupLaps(group);
  const { toggle } = useLapSelection(group);
  const best = useMemo(
    () => new Map(bestLaps(laps.data ?? []).map((lap) => [lap.driver, lap])),
    [laps.data]
  );

  if (data.straights.length === 0)
    return <PanelMessage>No straights found in this session.</PanelMessage>;

  const cell = (stats: EnergyStraightStats | null) => {
    if (stats == null) return { text: '', faint: true, title: undefined };
    const title =
      `${stats.laps} laps, ${Math.round(stats.clipping * 100)}% clip, median ` +
      `${stats.clipped} m, ${stats.cost_time.toFixed(3)} s, top ${stats.peak_speed.toFixed(0)}, ` +
      `downshift at full throttle in ${Math.round(stats.downshifts * 100)}%, ` +
      `loses speed at full throttle in ${Math.round(stats.superclipping * 100)}%`;
    if (metric === 'downshifts')
      return {
        text: stats.downshifts > 0 ? `${Math.round(stats.downshifts * 100)}%` : '–',
        faint: stats.downshifts === 0,
        title,
      };
    if (metric === 'lost')
      return {
        text: stats.lost > 0 ? `−${stats.lost.toFixed(0)}` : '–',
        faint: stats.lost === 0,
        title,
      };
    if (metric === 'clipped')
      return {
        text: stats.clipped > 0 ? String(stats.clipped) : '–',
        faint: stats.clipped === 0,
        title,
      };
    return {
      text: stats.cost_time >= 0.0005 ? stats.cost_time.toFixed(3) : '–',
      faint: stats.cost_time < ENERGY_LEVEL,
      title,
    };
  };

  return (
    <table className="w-full whitespace-nowrap text-[11px]">
      <thead>
        <tr>
          <th className={cn(th, 'text-left')}>Driver</th>
          <th className={cn(th, 'text-right')}>Laps</th>
          <th className={cn(th, 'text-right')} title="Median per lap, all straights">
            Per lap
          </th>
          {data.straights.map((s) => (
            <th
              key={s.corner}
              className={cn(th, 'text-right')}
              title={`${straightLabel(s)}: ${METRIC_TITLES[metric]}`}
            >
              →T{s.corner}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.drivers.map((driver) => {
          const lap = best.get(driver.driver);
          const isSelected = selected.some((s) => s.driver === driver.driver);
          return (
            <tr
              key={driver.driver}
              onClick={() => lap && toggle(lap)}
              className="cursor-pointer hover:bg-raised"
              style={rowStyle(isSelected, group)}
              title={lap ? `Click to select ${driver.driver}’s best lap (L${lap.lap})` : undefined}
            >
              <DriverCell code={driver.driver} drivers={detail.data?.drivers ?? []} />
              <td className={cn(td, 'text-faint')}>{driver.laps}</td>
              <td className={cn(td, 'font-semibold')}>{driver.cost_time.toFixed(3)}</td>
              {driver.straights.map((stats, i) => {
                const c = cell(stats);
                return (
                  <td
                    key={data.straights[i].corner}
                    className={cn(td, c.faint && 'text-faint')}
                    title={c.title}
                  >
                    {c.text}
                  </td>
                );
              })}
            </tr>
          );
        })}
        <tr className="border-t border-line text-faint">
          <td className="px-1.5 py-[1px] text-left text-[10px] uppercase">Session</td>
          <td className={td}>{data.clean_laps}</td>
          <td />
          {data.straights.map((s) => {
            const c = cell(s.session);
            return (
              <td key={s.corner} className={td} title={c.title}>
                {c.text}
              </td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
}
