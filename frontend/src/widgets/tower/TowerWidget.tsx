import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Lap, LapPrediction, OvertakeCheck, TimingState, TowerRow } from '@/api/client';
import { useLaps, usePredictions, useSessionDetail, useTimingState } from '@/api/queries';
import { DriverCell, PanelMessage, TyreBadge } from '@/components/data/bits';
import { TRACK_STATUS_COLORS } from '@/lib/colors';
import { formatGap, formatLapTime, formatSector } from '@/lib/format';
import { describeCheck } from '@/lib/overtake';
import { TRACK_STATUS_LABEL } from '@/lib/replay';
import { rowStyle, td, th } from '@/lib/table';
import { TIMING_TEXT } from '@/lib/timing';
import { cn } from '@/lib/utils';
import { useClockTime } from '@/store/clock';
import { useGroupLaps, useGroups } from '@/store/groups';
import type { WidgetProps } from '../types';
import { useOvertakeMode } from '../useOvertakeMode';
import type { TowerConfig } from './widget';

const STATUS_LABEL: Partial<Record<TowerRow['status'], string>> = {
  pit: 'PIT',
  garage: 'PIT',
  retired: 'DNF',
  out_lap: 'OUT',
  in_lap: 'IN',
};

type Segment = TowerRow['segments'][number][number];

const SEGMENT_BG: Record<Segment, string> = {
  best: 'bg-best',
  pb: 'bg-pb',
  slow: 'bg-slow',
  pit: 'bg-pit',
  none: 'bg-line-strong',
};

/** F1's mini-sectors of one sector: a bar per segment along the bottom of the cell. */
function SegmentBars({ segments }: { segments: Segment[] }) {
  return (
    <span className="absolute inset-x-1.5 bottom-0 flex h-[2px] gap-px">
      {segments.map((s, i) => (
        <span key={i} className={cn('min-w-0 flex-1', SEGMENT_BG[s])} />
      ))}
    </span>
  );
}

function OvertakeCell({ check }: { check: OvertakeCheck | null }) {
  return (
    <td className="px-1.5 py-[1px] text-left" title={check ? describeCheck(check) : undefined}>
      {check ? <span className="text-[10px] font-semibold text-ers">OT</span> : null}
    </td>
  );
}

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
        <span className="text-faint">
          top {state.cutoff} go through
          {cutTime(state) != null ? (
            <>
              {' · cut '}
              <span className="text-dim">{formatLapTime(cutTime(state))}</span>
            </>
          ) : null}
        </span>
      ) : null}
      {status !== 'green' ? (
        <span className="ml-auto font-semibold" style={{ color: TRACK_STATUS_COLORS[status] }}>
          {TRACK_STATUS_LABEL[status]}
        </span>
      ) : null}
    </div>
  );
}

/** Qualifying: the best lap of the last driver through, if he has one. */
function cutTime(state: TimingState): number | null {
  return state.cutoff != null ? (state.rows[state.cutoff - 1]?.best_lap ?? null) : null;
}

/** Qualifying: inside the cut the margin to the first driver out (negative), below it what is
 * still needed to get in (positive). */
function toCut(state: TimingState, i: number): number | null {
  const own = state.rows[i]?.best_lap;
  if (state.cutoff == null || own == null) return null;
  const other = state.rows[i < state.cutoff ? state.cutoff : state.cutoff - 1]?.best_lap;
  return other == null ? null : own - other;
}

/** The position a predicted lap time would give, among the others' best laps that still count. */
function predictedPosition(state: TimingState, driver: string, time: number): number {
  return (
    1 +
    state.rows.filter(
      (r) => r.driver !== driver && !r.eliminated && r.best_lap != null && r.best_lap < time
    ).length
  );
}

function PredictionCell({
  state,
  row,
  prediction,
}: {
  state: TimingState;
  row: TowerRow;
  prediction: LapPrediction | undefined;
}) {
  if (!prediction) return <td className={td} />;
  const best = Math.min(
    ...state.rows.filter((r) => !r.eliminated && r.best_lap != null).map((r) => r.best_lap!)
  );
  const timing =
    prediction.predicted < best
      ? 'best'
      : row.best_lap == null || prediction.predicted < row.best_lap
        ? 'pb'
        : 'none';
  const position = predictedPosition(state, row.driver, prediction.predicted);
  const out = state.cutoff != null && position > state.cutoff;
  return (
    <td
      className={td}
      title={`${Math.round(prediction.fraction * 100)}% of the lap, ${formatGap(prediction.delta)} to his best`}
    >
      <span className={TIMING_TEXT[timing]}>{formatLapTime(prediction.predicted)}</span>
      <span
        className={cn(
          'ml-1 inline-block w-6 text-left text-[10px]',
          out ? 'text-pit' : 'text-faint'
        )}
      >
        P{position}
      </span>
    </td>
  );
}

/** Never blow the tower up more than this: past it the rows are just big, not easier to read. */
const MAX_ZOOM = 2.4;

/**
 * Size "fit": scale the table (CSS zoom) so it fills the panel, the smaller of the width and the
 * height. 1 when compact, or when the table does not fit anyway (then it scrolls).
 */
function useFitZoom(fit: boolean, rows: number) {
  // A callback ref: the box only exists once the timing has loaded.
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!box) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [box]);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const t = table.current;
    if (!fit || !t || size.width === 0) {
      setZoom(1);
      return;
    }
    // The rect is zoomed; divided by the zoom it is the table's own size.
    const rect = t.getBoundingClientRect();
    const current = Number(t.style.zoom) || 1;
    const natural = { width: rect.width / current, height: rect.height / current };
    const next = Math.min(
      Math.max(Math.min(size.width / natural.width, size.height / natural.height), 1),
      MAX_ZOOM
    );
    setZoom((z) => (Math.abs(z - next) > 0.01 ? next : z));
  }, [fit, size.width, size.height, rows]);
  return { box: setBox, table, zoom };
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
  const { box, table, zoom } = useFitZoom(config.size === 'fit', timing.data?.rows.length ?? 0);
  const t = useClockTime(1000);
  const timed = timing.data != null && timing.data.kind !== 'race';
  const predictions = usePredictions(t, timed && config.columns.includes('predicted')).data;
  const wantOvertake = timing.data?.kind === 'race' && config.columns.includes('overtake');
  const overtakeAt = useOvertakeMode(wantOvertake);

  if (timing.error) return <PanelMessage>{timing.error.message}</PanelMessage>;
  const state = timing.data;
  if (!state || !detail.data) return <PanelMessage>Loading timing…</PanelMessage>;

  const show = new Set(config.columns);
  const race = state.kind === 'race';
  const showCut = show.has('cut') && state.cutoff != null;
  const showOvertake = race && show.has('overtake') && overtakeAt != null;
  const showPredicted = show.has('predicted') && !race;
  const byDriver = new Map((showPredicted ? (predictions ?? []) : []).map((p) => [p.driver, p]));
  // Only a live recording has them (F1's own timing), the archive does not.
  const segments = show.has('segments') && state.rows.some((r) => r.segments.length > 0);
  const head = (label: string, title?: string, align = 'text-right') => (
    <th className={cn(th, align)} title={title}>
      {label}
    </th>
  );

  return (
    <div className="flex h-full flex-col">
      <Header state={state} />
      <div ref={box} className="min-h-0 flex-1 overflow-auto">
        <table
          ref={table}
          className={cn(
            'whitespace-nowrap text-[11px] tabular-nums',
            config.size === 'fit' ? 'w-auto' : 'w-full'
          )}
          style={config.size === 'fit' ? { zoom } : undefined}
        >
          <thead>
            <tr>
              {head('P')}
              {head('Drv', undefined, 'text-left')}
              {head('Gap', race ? 'To the leader, at the last timing line' : 'Best lap to P1')}
              {show.has('interval') ? head('Int', 'To the car ahead') : null}
              {showOvertake
                ? head('OT', 'Overtake mode: within 1 s at the detection line', 'text-left')
                : null}
              {showCut
                ? head('Cut', 'Margin to the first driver out, or what is needed to get in')
                : null}
              {showPredicted ? head('Pred', 'The lap in progress is on course for this') : null}
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
                  {showOvertake ? (
                    <OvertakeCell check={out || !overtakeAt ? null : overtakeAt(row.driver, t)} />
                  ) : null}
                  {showCut ? (
                    <td
                      className={cn(
                        td,
                        out ? 'text-faint' : i < (state.cutoff ?? 0) ? 'text-dim' : 'text-pit'
                      )}
                    >
                      {out ? '' : formatGap(toCut(state, i))}
                    </td>
                  ) : null}
                  {showPredicted ? (
                    out ? (
                      <td className={td} />
                    ) : (
                      <PredictionCell
                        state={state}
                        row={row}
                        prediction={byDriver.get(row.driver)}
                      />
                    )
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
                            segments && 'relative',
                            s.current && !out ? TIMING_TEXT[s.timing] : 'text-faint'
                          )}
                        >
                          {formatSector(s.time)}
                          {segments && !out && row.segments[k] ? (
                            <SegmentBars segments={row.segments[k]} />
                          ) : null}
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
