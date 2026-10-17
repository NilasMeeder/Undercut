import { useMemo, useState } from 'react';
import type { DriverInfo, Lap } from '@/api/client';
import { useLaps, useSessionDetail } from '@/api/queries';
import { PanelMessage, TyreBadge } from '@/components/data/bits';
import { cn } from '@/lib/utils';
import { formatGap, formatLapTime, formatSector } from '@/lib/format';
import { bestLaps, classify, computeBests, TIMING_TEXT, type Bests } from '@/lib/timing';
import { GROUP_COLORS, sameLap, useGroupLaps, useGroups, type GroupId } from '@/store/groups';
import type { WidgetProps } from '../types';

type View = 'classification' | 'laps';

export function LapsWidget({ group }: WidgetProps<Record<string, never>>) {
  const laps = useLaps();
  const detail = useSessionDetail();
  const [view, setView] = useState<View>('classification');
  const [driverFilter, setDriverFilter] = useState<string[]>([]);

  const bests = useMemo(() => computeBests(laps.data ?? []), [laps.data]);
  const classification = useMemo(() => bestLaps(laps.data ?? []), [laps.data]);
  const order = useMemo(() => classification.map((l) => l.driver), [classification]);

  if (laps.error) return <PanelMessage>{laps.error.message}</PanelMessage>;
  if (!laps.data || !detail.data) return <PanelMessage>Loading laps…</PanelMessage>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-line px-1 py-0.5">
        {(['classification', 'laps'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn(
              'px-2 py-0.5 text-[10px] uppercase tracking-wide',
              view === v ? 'bg-raised text-text' : 'text-faint hover:text-dim'
            )}
          >
            {v}
          </button>
        ))}
        <span className="ml-auto pr-1 text-[10px] text-faint">click a row to compare</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {view === 'classification' ? (
          <Classification
            group={group}
            rows={classification}
            bests={bests}
            drivers={detail.data.drivers}
          />
        ) : (
          <AllLaps
            group={group}
            laps={laps.data}
            order={order}
            bests={bests}
            drivers={detail.data.drivers}
            filter={driverFilter}
            setFilter={setDriverFilter}
          />
        )}
      </div>
    </div>
  );
}

const th = 'sticky top-0 bg-panel px-1.5 py-0.5 text-[10px] font-medium uppercase text-faint';
const td = 'px-1.5 py-[1px] text-right';

function useLapSelection(group: GroupId) {
  const selected = useGroupLaps(group);
  const toggleLap = useGroups((s) => s.toggleLap);
  return {
    isSelected: (lap: Lap) => selected.some((s) => sameLap(s, lap)),
    toggle: (lap: Lap) => toggleLap(group, { driver: lap.driver, lap: lap.lap }),
  };
}

function rowStyle(selected: boolean, group: GroupId): React.CSSProperties {
  return {
    boxShadow: selected ? `inset 2px 0 0 ${GROUP_COLORS[group]}` : undefined,
  };
}

function DriverCell({ code, drivers }: { code: string; drivers: DriverInfo[] }) {
  const color = drivers.find((d) => d.code === code)?.color;
  return (
    <td className="px-1.5 py-[1px] text-left font-semibold">
      <span
        className="mr-1.5 inline-block h-2.5 w-[3px] align-[-1px]"
        style={{ background: color }}
      />
      {code}
    </td>
  );
}

function TimingCells({ lap, bests }: { lap: Lap; bests: Bests }) {
  return (
    <>
      <td className={cn(td, TIMING_TEXT[classify(lap, 'sector_1', bests)])}>
        {formatSector(lap.sector_1)}
      </td>
      <td className={cn(td, TIMING_TEXT[classify(lap, 'sector_2', bests)])}>
        {formatSector(lap.sector_2)}
      </td>
      <td className={cn(td, TIMING_TEXT[classify(lap, 'sector_3', bests)])}>
        {formatSector(lap.sector_3)}
      </td>
    </>
  );
}

function Classification({
  group,
  rows,
  bests,
  drivers,
}: {
  group: GroupId;
  rows: Lap[];
  bests: Bests;
  drivers: DriverInfo[];
}) {
  const { isSelected, toggle } = useLapSelection(group);
  const leader = rows[0]?.lap_time ?? null;
  return (
    <table className="w-full whitespace-nowrap text-[11px]">
      <thead>
        <tr>
          <th className={cn(th, 'text-right')}>P</th>
          <th className={cn(th, 'text-left')}>Drv</th>
          <th className={cn(th, 'text-right')}>Best</th>
          <th className={cn(th, 'text-right')}>Gap</th>
          <th className={cn(th, 'text-right')}>S1</th>
          <th className={cn(th, 'text-right')}>S2</th>
          <th className={cn(th, 'text-right')}>S3</th>
          <th className={cn(th, 'text-center')}>Tyre</th>
          <th className={cn(th, 'text-right')}>Lap</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((lap, i) => {
          const selected = isSelected(lap);
          return (
            <tr
              key={lap.driver}
              onClick={() => toggle(lap)}
              style={rowStyle(selected, group)}
              className={cn('cursor-pointer hover:bg-raised', selected && 'bg-raised')}
            >
              <td className={cn(td, 'text-faint')}>{i + 1}</td>
              <DriverCell code={lap.driver} drivers={drivers} />
              <td className={cn(td, TIMING_TEXT[classify(lap, 'lap_time', bests)])}>
                {formatLapTime(lap.lap_time)}
              </td>
              <td className={cn(td, 'text-dim')}>
                {i === 0 || leader == null ? '' : formatGap(lap.lap_time! - leader)}
              </td>
              <TimingCells lap={lap} bests={bests} />
              <td className="px-1.5 text-center">
                <TyreBadge compound={lap.compound} />
              </td>
              <td className={cn(td, 'text-faint')}>{lap.lap}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function lapNote(lap: Lap): string {
  if (lap.deleted) return 'DEL';
  if (lap.pit_out) return 'OUT';
  if (lap.pit_in) return 'IN';
  if (lap.track_status && /[4-7]/.test(lap.track_status)) return 'SC';
  return '';
}

function AllLaps({
  group,
  laps,
  order,
  bests,
  drivers,
  filter,
  setFilter,
}: {
  group: GroupId;
  laps: Lap[];
  order: string[];
  bests: Bests;
  drivers: DriverInfo[];
  filter: string[];
  setFilter: (filter: string[]) => void;
}) {
  const { isSelected, toggle } = useLapSelection(group);
  const codes = useMemo(
    () => [...order, ...drivers.map((d) => d.code).filter((c) => !order.includes(c))],
    [order, drivers]
  );
  const shown = useMemo(() => {
    const rank = new Map(codes.map((c, i) => [c, i]));
    return laps
      .filter((l) => filter.length === 0 || filter.includes(l.driver))
      .sort((a, b) => (rank.get(a.driver) ?? 99) - (rank.get(b.driver) ?? 99) || a.lap - b.lap);
  }, [laps, filter, codes]);

  const toggleDriver = (code: string) =>
    setFilter(filter.includes(code) ? filter.filter((c) => c !== code) : [...filter, code]);

  return (
    <>
      <div className="flex flex-wrap gap-0.5 border-b border-line p-1">
        {codes.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => toggleDriver(code)}
            className={cn(
              'px-1 text-[10px] font-semibold',
              filter.includes(code) ? 'bg-raised text-text' : 'text-faint hover:text-dim'
            )}
          >
            {code}
          </button>
        ))}
      </div>
      <table className="w-full whitespace-nowrap text-[11px]">
        <thead>
          <tr>
            <th className={cn(th, 'text-left')}>Drv</th>
            <th className={cn(th, 'text-right')}>Lap</th>
            <th className={cn(th, 'text-right')}>Time</th>
            <th className={cn(th, 'text-right')}>S1</th>
            <th className={cn(th, 'text-right')}>S2</th>
            <th className={cn(th, 'text-right')}>S3</th>
            <th className={cn(th, 'text-center')}>Tyre</th>
            <th className={cn(th, 'text-right')}>Age</th>
            <th className={cn(th, 'text-right')}>Trap</th>
            <th className={cn(th, 'text-left')}></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((lap) => {
            const selected = isSelected(lap);
            const note = lapNote(lap);
            return (
              <tr
                key={`${lap.driver}-${lap.lap}`}
                onClick={() => toggle(lap)}
                style={rowStyle(selected, group)}
                className={cn(
                  'cursor-pointer hover:bg-raised',
                  selected && 'bg-raised',
                  note && 'text-faint'
                )}
              >
                <DriverCell code={lap.driver} drivers={drivers} />
                <td className={cn(td, 'text-faint')}>{lap.lap}</td>
                <td
                  className={cn(
                    td,
                    lap.deleted
                      ? 'text-faint line-through'
                      : TIMING_TEXT[classify(lap, 'lap_time', bests)]
                  )}
                >
                  {formatLapTime(lap.lap_time)}
                </td>
                <TimingCells lap={lap} bests={bests} />
                <td className="px-1.5 text-center">
                  <TyreBadge compound={lap.compound} />
                </td>
                <td className={cn(td, 'text-faint')}>{lap.tyre_life ?? ''}</td>
                <td className={cn(td, 'text-dim')}>{lap.speed_trap?.toFixed(0) ?? ''}</td>
                <td
                  className={cn(
                    'px-1.5 text-[10px]',
                    note === 'DEL' || note === 'IN' ? 'text-pit' : 'text-slow'
                  )}
                  title={lap.deleted_reason ?? undefined}
                >
                  {note}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
