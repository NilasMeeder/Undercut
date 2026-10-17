import type { Lap, TimingState, TowerRow } from '@/api/client';
import { useLaps, useSessionDetail, useTimingState } from '@/api/queries';
import { DriverCell, PanelMessage, TyreBadge } from '@/components/data/bits';
import { TRACK_STATUS_COLORS } from '@/lib/colors';
import { formatGap, formatLapTime, formatSector } from '@/lib/format';
import { TRACK_STATUS_LABEL } from '@/lib/replay';
import { rowStyle, td, th } from '@/lib/table';
import { TIMING_TEXT } from '@/lib/timing';
import { cn } from '@/lib/utils';
import { useGroupLaps, useGroups } from '@/store/groups';
import type { WidgetProps } from '../types';
import type { TowerConfig } from './widget';

const STATUS_LABEL: Partial<Record<TowerRow['status'], string>> = {
  pit: 'PIT',
  garage: 'PIT',
  retired: 'DNF',
  out_lap: 'OUT',
  in_lap: 'IN',
};

function gapText(seconds: number | null, lapsDown: number): string {
  if (lapsDown > 0) return `+${lapsDown} LAP${lapsDown > 1 ? 'S' : ''}`;
  return formatGap(seconds);
}

function Header({ state }: { state: TimingState }) {
  const status = state.track_status;
  return (
    <div className="flex shrink-0 items-baseline gap-3 border-b border-line px-1.5 py-0.5 text-[11px]">
      <span className="font-semibold">
        {state.kind === 'race'
          ? `LAP ${state.lap ?? '–'}/${state.total_laps ?? '–'}`
          : (state.segment ?? 'PRACTICE')}
      </span>
      {state.cutoff != null ? (
        <span className="text-faint">top {state.cutoff} go through</span>
      ) : null}
      {status !== 'green' ? (
        <span className="ml-auto font-semibold" style={{ color: TRACK_STATUS_COLORS[status] }}>
          {TRACK_STATUS_LABEL[status]}
        </span>
      ) : null}
    </div>
  );
}

/** The lap a row click compares: the latest lap in a race, the best lap otherwise. */
function lapFor(row: TowerRow, kind: TimingState['kind'], laps: Lap[]): number | null {
  if (kind === 'race') return row.laps > 0 ? row.laps : null;
  if (row.best_lap == null) return null;
  return laps.find((l) => l.driver === row.driver && l.lap_time === row.best_lap)?.lap ?? null;
}

export function TowerWidget({ group, config }: WidgetProps<TowerConfig>) {
  const timing = useTimingState();
  const detail = useSessionDetail();
  const laps = useLaps();
  const selected = new Set(useGroupLaps(group).map((l) => l.driver));
  const toggleLap = useGroups((s) => s.toggleLap);

  if (timing.error) return <PanelMessage>{timing.error.message}</PanelMessage>;
  const state = timing.data;
  if (!state || !detail.data) return <PanelMessage>Loading timing…</PanelMessage>;

  const show = new Set(config.columns);
  const race = state.kind === 'race';
  const head = (label: string, title?: string, align = 'text-right') => (
    <th className={cn(th, align)} title={title}>
      {label}
    </th>
  );

  return (
    <div className="flex h-full flex-col">
      <Header state={state} />
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full whitespace-nowrap text-[11px] tabular-nums">
          <thead>
            <tr>
              {head('P')}
              {head('Drv', undefined, 'text-left')}
              {head('Gap', race ? 'To the leader, at the last timing line' : 'Best lap to P1')}
              {show.has('interval') ? head('Int', 'To the car ahead') : null}
              {show.has('best') ? head('Best') : null}
              {show.has('last') ? head('Last') : null}
              {show.has('sectors') ? (
                <>
                  {head('S1')}
                  {head('S2')}
                  {head('S3')}
                </>
              ) : null}
              {show.has('tyre') ? head('Tyre', undefined, 'text-left') : null}
              {show.has('stops') ? head(race ? 'Pit' : 'Laps', race ? 'Pit stops' : 'Laps') : null}
              {head('', undefined, 'text-left')}
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row, i) => {
              const out = row.status === 'retired' || row.eliminated;
              const isSelected = selected.has(row.driver);
              const lap = lapFor(row, state.kind, laps.data ?? []);
              const cut = state.cutoff != null && i === state.cutoff - 1;
              return (
                <tr
                  key={row.driver}
                  onClick={
                    lap != null ? () => toggleLap(group, { driver: row.driver, lap }) : undefined
                  }
                  style={rowStyle(isSelected, group)}
                  className={cn(
                    'cursor-pointer hover:bg-raised',
                    isSelected && 'bg-raised',
                    out && 'text-faint',
                    cut && 'border-b border-pit'
                  )}
                >
                  <td className={cn(td, 'text-faint')}>{row.position}</td>
                  <DriverCell code={row.driver} drivers={detail.data.drivers} />
                  <td className={cn(td, out ? 'text-faint' : 'text-dim')}>
                    {i === 0 || out ? '' : gapText(row.gap, row.laps_down)}
                  </td>
                  {show.has('interval') ? (
                    <td className={cn(td, out ? 'text-faint' : 'text-text')}>
                      {i === 0 || out ? '' : gapText(row.interval, row.interval_laps)}
                    </td>
                  ) : null}
                  {show.has('best') ? (
                    <td className={cn(td, !out && TIMING_TEXT[row.best_timing])}>
                      {formatLapTime(row.best_lap)}
                    </td>
                  ) : null}
                  {show.has('last') ? (
                    <td className={cn(td, !out && TIMING_TEXT[row.last_timing])}>
                      {formatLapTime(row.last_lap)}
                    </td>
                  ) : null}
                  {show.has('sectors')
                    ? row.sectors.map((s, k) => (
                        <td
                          key={k}
                          className={cn(
                            td,
                            s.current && !out ? TIMING_TEXT[s.timing] : 'text-faint'
                          )}
                        >
                          {formatSector(s.time)}
                        </td>
                      ))
                    : null}
                  {show.has('tyre') ? (
                    <td className="px-1.5 py-[1px]">
                      <span className="inline-flex items-center gap-1">
                        <TyreBadge compound={row.compound} />
                        <span className="w-4 text-right text-faint">{row.tyre_age ?? ''}</span>
                      </span>
                    </td>
                  ) : null}
                  {show.has('stops') ? (
                    <td className={cn(td, 'text-dim')}>{race ? row.pit_stops : row.laps}</td>
                  ) : null}
                  <td
                    className={cn(
                      'px-1.5 py-[1px] text-[10px]',
                      row.status === 'pit' || row.status === 'retired' ? 'text-pit' : 'text-faint'
                    )}
                  >
                    {STATUS_LABEL[row.status] ?? ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
