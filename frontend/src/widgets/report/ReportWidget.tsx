import { useMemo, type ReactNode } from 'react';
import type { DriverInfo, ReportAction, ReportRun, SessionReport } from '@/api/client';
import { useReport, useSessionDetail } from '@/api/queries';
import { PanelMessage, TyreBadge } from '@/components/data/bits';
import { formatGap } from '@/lib/format';
import {
  actionTitle,
  clippingLine,
  cornerLine,
  momentLine,
  parseLapRef,
  runLine,
  stintLine,
} from '@/lib/report';
import { clock } from '@/store/clock';
import { cursorBus } from '@/store/cursor';
import { useGroups, type GroupId } from '@/store/groups';
import type { WidgetProps } from '../types';
import type { ReportConfig } from './widget';

/** Open what a line points at: its laps in the group (zoomed), or the clock at the moment. */
function run(group: GroupId, action: ReportAction) {
  if (action.laps.length > 0) useGroups.getState().setLaps(group, action.laps.map(parseLapRef));
  if (action.zoom) cursorBus.setZoom(group, [action.zoom[0], action.zoom[1]]);
  else if (action.laps.length > 0) cursorBus.setZoom(group, null);
  if (action.t != null) clock.seek(action.t);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line pb-1">
      <h3 className="px-1.5 pb-0.5 pt-1.5 text-[10px] font-medium uppercase text-faint">{title}</h3>
      {children}
    </section>
  );
}

/** One clickable line: a driver mark, an optional number, the sentence. */
function Line({
  group,
  action,
  driver,
  drivers,
  value,
  children,
}: {
  group: GroupId;
  action: ReportAction;
  driver?: string | null;
  drivers: DriverInfo[];
  value?: ReactNode;
  children: ReactNode;
}) {
  const color = driver ? drivers.find((d) => d.code === driver)?.color : undefined;
  return (
    <button
      type="button"
      onClick={() => run(group, action)}
      title={actionTitle(action)}
      className="flex w-full items-baseline gap-1.5 px-1.5 py-[2px] text-left hover:bg-raised"
    >
      <span
        className="inline-block h-2.5 w-[3px] shrink-0 self-center"
        style={{ background: color ?? 'transparent' }}
      />
      {value != null ? (
        <span className="w-14 shrink-0 text-right tabular-nums text-dim">{value}</span>
      ) : null}
      <span className="min-w-0 text-dim">{children}</span>
    </button>
  );
}

function LongRuns({
  group,
  runs,
  drivers,
}: {
  group: GroupId;
  runs: ReportRun[];
  drivers: DriverInfo[];
}) {
  const byCompound = useMemo(() => {
    const out = new Map<string, ReportRun[]>();
    for (const r of runs) {
      const key = r.compound ?? 'UNKNOWN';
      out.set(key, [...(out.get(key) ?? []), r]);
    }
    return [...out.entries()];
  }, [runs]);
  return (
    <>
      {byCompound.map(([compound, list]) => (
        <div key={compound}>
          <div className="flex items-center gap-1 px-1.5 pt-0.5 text-[10px] text-faint">
            <TyreBadge compound={compound} /> {compound}
          </div>
          {list.map((r) => (
            <Line
              key={`${r.driver}-${r.stint}`}
              group={group}
              action={r.action}
              driver={r.driver}
              drivers={drivers}
            >
              {runLine(r, list[0])}
            </Line>
          ))}
        </div>
      ))}
    </>
  );
}

function Report({ group, data }: { group: GroupId; data: SessionReport }) {
  const detail = useSessionDetail();
  const drivers = detail.data?.drivers ?? [];
  const empty =
    data.corners.length +
      data.long_runs.length +
      data.stints.length +
      data.clipping.length +
      data.moments.length ===
    0;
  if (empty) return <PanelMessage>Nothing stands out in this session’s data.</PanelMessage>;
  return (
    <div className="text-[11px] leading-snug">
      {data.moments.length > 0 && data.kind === 'race' ? (
        <Section title="Race">
          {data.moments.map((m, i) => (
            <Line
              key={`${m.kind}-${i}`}
              group={group}
              action={m.action}
              driver={m.driver}
              drivers={drivers}
              value={m.lap != null ? `L${m.lap}` : ''}
            >
              {momentLine(m)}
            </Line>
          ))}
        </Section>
      ) : null}
      {data.corners.length > 0 ? (
        <Section
          title={`Where the time is · vs ${data.corners[0].reference} L${data.corners[0].reference_lap}`}
        >
          {data.corners.map((c) => (
            <Line
              key={c.driver}
              group={group}
              action={c.action}
              driver={c.driver}
              drivers={drivers}
              value={formatGap(c.gap)}
            >
              {cornerLine(c)}
            </Line>
          ))}
        </Section>
      ) : null}
      {data.long_runs.length > 0 ? (
        <Section title="Long runs · median lap, no fuel correction">
          <LongRuns group={group} runs={data.long_runs} drivers={drivers} />
        </Section>
      ) : null}
      {data.stints.length > 0 ? (
        <Section title="Degradation · fuel-corrected">
          {data.compounds.length > 0 ? (
            <div className="flex flex-wrap gap-x-3 px-1.5 pb-0.5 pl-[18px] text-faint">
              {data.compounds.map((c) => (
                <span key={c.compound} className="flex items-center gap-1 tabular-nums">
                  <TyreBadge compound={c.compound} />
                  {c.slope >= 0 ? '+' : '−'}
                  {Math.abs(c.slope).toFixed(3)} s/lap
                </span>
              ))}
            </div>
          ) : null}
          {data.stints.map((s) => (
            <Line
              key={`${s.driver}-${s.stint}`}
              group={group}
              action={s.action}
              driver={s.driver}
              drivers={drivers}
            >
              {stintLine(s)}
            </Line>
          ))}
        </Section>
      ) : null}
      {data.clipping.length > 0 ? (
        <Section title="Clipping · estimate">
          {data.clipping.map((c) => (
            <Line
              key={c.driver}
              group={group}
              action={c.action}
              driver={c.driver}
              drivers={drivers}
            >
              {clippingLine(c)}
            </Line>
          ))}
        </Section>
      ) : null}
    </div>
  );
}

export function ReportWidget({ group }: WidgetProps<ReportConfig>) {
  const report = useReport();
  if (report.error) return <PanelMessage>{report.error.message}</PanelMessage>;
  if (!report.data) return <PanelMessage>Going through the session…</PanelMessage>;
  return (
    <div className="h-full overflow-auto">
      <Report group={group} data={report.data} />
    </div>
  );
}
