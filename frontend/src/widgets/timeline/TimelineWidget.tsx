import { useMemo } from 'react';
import type { DriverInfo, Lap } from '@/api/client';
import { useLaps, useSessionDetail } from '@/api/queries';
import { PanelMessage } from '@/components/data/bits';
import { formatLapTime } from '@/lib/format';
import { bestLaps, classify, computeBests, countsForBests } from '@/lib/timing';
import { cn } from '@/lib/utils';
import { GROUP_COLORS, useLapSelection } from '@/store/groups';
import type { WidgetProps } from '../types';
import type { TimelineConfig } from './widget';

type Kind = 'best' | 'pb' | 'slow' | 'cool' | 'in' | 'out' | 'deleted' | 'none';

const BOX: Record<Kind, string> = {
  best: 'bg-best font-semibold text-bg',
  pb: 'bg-pb font-semibold text-bg',
  slow: 'bg-raised text-slow',
  cool: 'text-faint',
  in: 'text-pit',
  out: 'text-faint',
  deleted: 'text-faint line-through',
  none: 'text-faint',
};

/** A timed lap this much slower than the driver's best is a cool-down lap, not an attempt. */
const COOL_DOWN = 1.07;

function driverBests(laps: Lap[]): Map<string, number> {
  return new Map(bestLaps(laps).map((l) => [l.driver, l.lap_time!]));
}

/** Timing-screen colours as they were when each lap was set: walk the laps in session order. */
function liveKinds(laps: Lap[]): Map<Lap, Kind> {
  const finals = driverBests(laps);
  const ordered = [...laps].sort(
    (a, b) => (a.start_time ?? Infinity) - (b.start_time ?? Infinity) || a.lap - b.lap
  );
  const kinds = new Map<Lap, Kind>();
  const personal = new Map<string, number>();
  let session = Infinity;
  for (const lap of ordered) {
    const base = baseKind(lap, finals);
    if (base) {
      kinds.set(lap, base);
      continue;
    }
    const time = lap.lap_time!;
    if (time < session) {
      session = time;
      kinds.set(lap, 'best');
    } else if (time < (personal.get(lap.driver) ?? Infinity)) {
      kinds.set(lap, 'pb');
    } else {
      kinds.set(lap, 'slow');
    }
    personal.set(lap.driver, Math.min(time, personal.get(lap.driver) ?? Infinity));
  }
  return kinds;
}

function finalKinds(laps: Lap[]): Map<Lap, Kind> {
  const bests = computeBests(laps);
  const finals = driverBests(laps);
  const kinds = new Map<Lap, Kind>();
  for (const lap of laps) {
    const timing = classify(lap, 'lap_time', bests);
    kinds.set(lap, baseKind(lap, finals) ?? (timing === 'none' ? 'slow' : timing));
  }
  return kinds;
}

/** Laps that are not compared on time: pit laps, untimed, deleted and cool-down laps. */
function baseKind(lap: Lap, finals: Map<string, number>): Kind | null {
  if (lap.pit_in) return 'in';
  if (lap.pit_out) return 'out';
  if (lap.lap_time == null) return 'none';
  if (!countsForBests(lap)) return 'deleted';
  if (lap.lap_time > (finals.get(lap.driver) ?? Infinity) * COOL_DOWN) return 'cool';
  return null;
}

function label(lap: Lap, kind: Kind): string {
  if (kind === 'in') return 'IN';
  if (kind === 'out') return 'OUT';
  return formatLapTime(lap.lap_time) || '–';
}

type Block = { segment: string | null; rows: number; laps: Map<string, Lap[]> };

/** Qualifying: one block per segment, so Q2 starts on the same row for everyone. */
function buildBlocks(laps: Lap[]): Block[] {
  const blocks = new Map<string | null, Block>();
  for (const lap of [...laps].sort((a, b) => a.lap - b.lap)) {
    const key = lap.quali_segment ?? null;
    let block = blocks.get(key);
    if (!block) {
      block = { segment: key, rows: 0, laps: new Map() };
      blocks.set(key, block);
    }
    const list = block.laps.get(lap.driver) ?? [];
    list.push(lap);
    block.laps.set(lap.driver, list);
    block.rows = Math.max(block.rows, list.length);
  }
  return [...blocks.values()].sort((a, b) => (a.segment ?? '').localeCompare(b.segment ?? ''));
}

function driverOrder(laps: Lap[], drivers: DriverInfo[]): string[] {
  const order = bestLaps(laps).map((l) => l.driver);
  const rest = drivers.map((d) => d.code).filter((c) => !order.includes(c));
  return [...order, ...rest.filter((c) => laps.some((l) => l.driver === c))];
}

export function TimelineWidget({ group, config }: WidgetProps<TimelineConfig>) {
  const laps = useLaps();
  const detail = useSessionDetail();
  const { isSelected, toggle } = useLapSelection(group);

  const colours = config.colours;
  const kinds = useMemo(
    () => (colours === 'live' ? liveKinds(laps.data ?? []) : finalKinds(laps.data ?? [])),
    [laps.data, colours]
  );
  const blocks = useMemo(() => buildBlocks(laps.data ?? []), [laps.data]);
  const codes = useMemo(
    () => driverOrder(laps.data ?? [], detail.data?.drivers ?? []),
    [laps.data, detail.data]
  );

  if (laps.error) return <PanelMessage>{laps.error.message}</PanelMessage>;
  if (!laps.data || !detail.data) return <PanelMessage>Loading laps…</PanelMessage>;
  if (codes.length === 0) return <PanelMessage>No laps in this session.</PanelMessage>;

  const color = (code: string) => detail.data.drivers.find((d) => d.code === code)?.color;
  const columns = `28px repeat(${codes.length}, 54px)`;

  return (
    <div className="h-full overflow-auto text-[10px]">
      <div className="sticky top-0 z-10 grid bg-panel" style={{ gridTemplateColumns: columns }}>
        <span />
        {codes.map((code) => (
          <span
            key={code}
            className="flex items-center gap-1 px-1 py-0.5 text-[11px] font-semibold"
          >
            <span className="inline-block h-2.5 w-[3px]" style={{ background: color(code) }} />
            {code}
          </span>
        ))}
      </div>
      {blocks.map((block) => (
        <div key={block.segment ?? 'all'} className="border-t border-line">
          {Array.from({ length: block.rows }, (_, row) => (
            <div key={row} className="grid gap-y-px py-px" style={{ gridTemplateColumns: columns }}>
              <span className="pr-1 text-right text-faint">
                {row === 0 ? (block.segment ?? '') : ''}
              </span>
              {codes.map((code) => {
                const lap = block.laps.get(code)?.[row];
                if (!lap) return <span key={code} />;
                const kind = kinds.get(lap) ?? 'none';
                const selected = isSelected(lap);
                const timed = lap.lap_time != null;
                return (
                  <button
                    key={code}
                    type="button"
                    disabled={!timed}
                    onClick={() => toggle(lap)}
                    title={`${lap.driver} L${lap.lap} ${formatLapTime(lap.lap_time)} · ${lap.compound ?? '?'} (${lap.tyre_life ?? '?'} laps)${lap.deleted_reason ? ` · ${lap.deleted_reason}` : ''}`}
                    className={cn(
                      'mx-px h-4 text-center leading-4 tabular-nums',
                      BOX[kind],
                      timed && 'cursor-pointer hover:brightness-125'
                    )}
                    style={
                      selected
                        ? { outline: `1px solid ${GROUP_COLORS[group]}`, outlineOffset: -1 }
                        : undefined
                    }
                  >
                    {label(lap, kind)}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
