import { useMemo } from 'react';
import type { Pass } from '@/api/client';
import {
  useOvertake,
  usePasses,
  useSessionDetail,
  useStraightMode,
  useTimeline,
} from '@/api/queries';
import { PanelMessage } from '@/components/data/bits';
import { byCorner, tally, type PassTally } from '@/lib/passes';
import { formatClock } from '@/lib/replay';
import { td, th } from '@/lib/table';
import { cn } from '@/lib/utils';
import { clock, useClockTime } from '@/store/clock';
import { PositionsMessage } from '../PositionsMessage';
import type { WidgetProps } from '../types';
import { useGroupDrivers } from '../useStrategy';
import type { PassesConfig } from './widget';

export function PassesWidget({ group, config }: WidgetProps<PassesConfig>) {
  const timeline = useTimeline().data;
  const race = timeline?.kind === 'race';
  const passes = usePasses(race);
  const lines = useStraightMode(race).data;
  const checks = useOvertake(race && lines?.overtake != null).data;
  const detail = useSessionDetail();
  const selected = useGroupDrivers(group);
  const t = useClockTime(500);

  const all = passes.data;
  const picked = useMemo(() => new Set(selected), [selected]);
  const shown = useMemo(
    () =>
      (all ?? []).filter(
        (p) => config.drivers === 'all' || picked.has(p.driver) || picked.has(p.passed)
      ),
    [all, config.drivers, picked]
  );
  const rows = useMemo(
    () =>
      tally(shown, checks?.checks, lines?.overtake_enabled ?? [], t).filter(
        (r) => config.drivers === 'all' || picked.has(r.driver)
      ),
    [shown, checks, lines, t, config.drivers, picked]
  );
  const corners = useMemo(() => byCorner(shown, t), [shown, t]);
  const recent = useMemo(() => shown.filter((p) => p.time <= t).reverse(), [shown, t]);

  if (timeline && !race) return <PanelMessage>Passes are for races.</PanelMessage>;
  if (!all) {
    if (passes.error) return <PanelMessage>{passes.error.message}</PanelMessage>;
    if (passes.status && passes.status.state !== 'ready')
      return <PositionsMessage status={passes.status} error={null} />;
    return <PanelMessage>Loading passes…</PanelMessage>;
  }

  const withOvertake = lines?.overtake != null;
  const color = (code: string) => detail.data?.drivers.find((d) => d.code === code)?.color;
  const name = (code: string, dim = false) => (
    <span className={cn('whitespace-nowrap', dim ? 'text-dim' : 'font-semibold')}>
      <span
        className="mr-1 inline-block h-2.5 w-[3px] align-[-1px]"
        style={{ background: color(code) }}
      />
      {code}
    </span>
  );
  const total = recent.length;
  const ot = recent.filter((p) => p.overtake_mode).length;

  return (
    <div className="flex h-full flex-col text-[11px] tabular-nums">
      <div className="flex shrink-0 flex-wrap gap-x-3 px-1.5 py-0.5">
        <span>
          <span className="font-semibold">{total}</span> passes
        </span>
        {withOvertake && total > 0 ? (
          <span className="text-dim">
            <span className="text-ers">{ot}</span> with OT ({Math.round((ot / total) * 100)}%)
          </span>
        ) : null}
        <span className="text-faint">
          {corners
            .slice(0, 5)
            .map(([corner, n]) => `${corner} ${n}`)
            .join(' · ')}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {config.show !== 'list' && rows.length > 0 ? (
          <Drivers rows={rows} withOvertake={withOvertake} name={name} />
        ) : null}
        {config.show !== 'drivers' ? (
          <List passes={recent} withOvertake={withOvertake} name={name} />
        ) : null}
      </div>
    </div>
  );
}

function Drivers({
  rows,
  withOvertake,
  name,
}: {
  rows: PassTally[];
  withOvertake: boolean;
  name: (code: string) => React.ReactNode;
}) {
  return (
    <table className="w-full whitespace-nowrap">
      <thead>
        <tr>
          <th className={cn(th, 'text-left')}>Drv</th>
          <th className={cn(th, 'text-right')} title="Passes made">
            Made
          </th>
          <th className={cn(th, 'text-right')} title="Times passed">
            Lost
          </th>
          <th className={cn(th, 'text-right')}>Net</th>
          {withOvertake ? (
            <>
              <th className={cn(th, 'text-right')} title="Times he got overtake mode at OT D">
                Got
              </th>
              <th className={cn(th, 'text-right')} title="Passes made with overtake mode">
                OT pass
              </th>
            </>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const net = r.made - r.lost;
          return (
            <tr key={r.driver} className="border-b border-line">
              <td className="px-1.5 py-[1px] text-left">{name(r.driver)}</td>
              <td className={cn(td, 'text-text')}>{r.made || ''}</td>
              <td className={cn(td, 'text-dim')}>{r.lost || ''}</td>
              <td className={cn(td, net === 0 ? 'text-faint' : 'text-text')}>
                {net > 0 ? `+${net}` : net < 0 ? `−${-net}` : '0'}
              </td>
              {withOvertake ? (
                <>
                  <td className={cn(td, 'text-dim')}>{r.gotOvertake || ''}</td>
                  <td className={cn(td, 'text-ers')}>{r.madeWithOvertake || ''}</td>
                </>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function List({
  passes,
  withOvertake,
  name,
}: {
  passes: Pass[];
  withOvertake: boolean;
  name: (code: string, dim?: boolean) => React.ReactNode;
}) {
  if (passes.length === 0)
    return <div className="px-1.5 py-1 text-faint">No passes yet at the session clock.</div>;
  return (
    <div className="border-t border-line">
      {passes.map((p) => (
        <div
          key={`${p.time}-${p.driver}-${p.passed}`}
          onClick={() => clock.seek(p.time - 5)}
          className="flex cursor-pointer items-baseline gap-2 border-b border-line px-1.5 py-0.5 hover:bg-raised"
          title={`${formatClock(p.time)}: ${p.driver} past ${p.passed} into ${p.corner ?? '?'}, P${p.position}`}
        >
          <span className="w-7 shrink-0 text-faint">L{p.lap}</span>
          {name(p.driver)}
          <span className="text-faint">past</span>
          {name(p.passed, true)}
          <span className="text-dim">{p.corner}</span>
          <span className="ml-auto flex gap-2">
            {withOvertake && p.overtake_mode ? (
              <span className="text-[10px] font-semibold text-ers">OT</span>
            ) : null}
            <span className="text-dim">P{p.position}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
