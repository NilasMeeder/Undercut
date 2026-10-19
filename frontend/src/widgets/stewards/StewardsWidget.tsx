import { useMemo } from 'react';
import { useSessionDetail, useStewarding, useTimeline } from '@/api/queries';
import { PanelMessage } from '@/components/data/bits';
import { td, th } from '@/lib/table';
import {
  STATUS_LABEL,
  STRIKES_FOR_FLAG,
  incidentsAt,
  penaltyLabel,
  recordsAt,
  type DriverRecord,
  type IncidentNow,
} from '@/lib/stewards';
import { cn } from '@/lib/utils';
import { clock, useClockTime } from '@/store/clock';
import type { WidgetProps } from '../types';
import type { StewardsConfig } from './widget';

const timeOfDay = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function StewardsWidget({ config }: WidgetProps<StewardsConfig>) {
  const stewarding = useStewarding();
  const detail = useSessionDetail();
  const t0 = useTimeline().data?.t0_utc;
  const t = useClockTime(500);
  const data = stewarding.data;
  const records = useMemo(() => (data ? recordsAt(data, t) : []), [data, t]);
  const incidents = useMemo(() => (data ? incidentsAt(data, t) : []), [data, t]);

  if (stewarding.error) return <PanelMessage>{stewarding.error.message}</PanelMessage>;
  if (!data) return <PanelMessage>Loading race control…</PanelMessage>;
  if (records.length === 0 && incidents.length === 0)
    return <PanelMessage>Nothing from the stewards yet at the session clock.</PanelMessage>;

  const race = detail.data?.code === 'R' || detail.data?.code === 'S';
  const color = (code: string) => detail.data?.drivers.find((d) => d.code === code)?.color;
  const clockOf = (time: number | null) =>
    time != null && t0 ? timeOfDay.format(new Date(Date.parse(t0) + time * 1000)) : '';
  const name = (code: string) => (
    <span key={code} className="mr-1.5 whitespace-nowrap">
      <span
        className="mr-1 inline-block h-2.5 w-[3px] align-[-1px]"
        style={{ background: color(code) }}
      />
      {code}
    </span>
  );

  return (
    <div className="h-full overflow-auto text-[11px] tabular-nums">
      {config.show !== 'incidents' && records.length > 0 ? (
        <Drivers records={records} race={race} name={name} />
      ) : null}
      {config.show !== 'drivers' && incidents.length > 0 ? (
        <Incidents incidents={incidents} clockOf={clockOf} name={name} />
      ) : null}
    </div>
  );
}

function Drivers({
  records,
  race,
  name,
}: {
  records: DriverRecord[];
  race: boolean;
  name: (code: string) => React.ReactNode;
}) {
  return (
    <table className="w-full whitespace-nowrap">
      <thead>
        <tr>
          <th className={cn(th, 'text-left')}>Drv</th>
          <th className={cn(th, 'text-right')} title="Laps deleted for track limits">
            TL
          </th>
          <th className={cn(th, 'text-left')} title="Penalties (red: not served yet)">
            Pen
          </th>
          <th className={cn(th, 'text-right')} title="Incidents noted or under investigation">
            Inv
          </th>
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr key={r.driver} className="border-b border-line">
            <td className="px-1.5 py-[1px] text-left font-semibold">{name(r.driver)}</td>
            <td
              className={cn(
                td,
                r.strikes.length >= STRIKES_FOR_FLAG && race ? 'text-text' : 'text-dim'
              )}
              title={[...r.strikes, ...r.otherDeleted]
                .map(
                  (d) =>
                    `L${d.lap ?? '?'} ${d.turn ?? ''} ${d.lap_time ?? ''}${d.track_limits ? '' : ` (${d.reason})`}`
                )
                .join('\n')}
            >
              {r.blackAndWhite ? (
                <span className="mr-1 border border-text px-0.5 text-[9px] font-semibold">B/W</span>
              ) : null}
              {r.strikes.length || ''}
            </td>
            <td className="px-1.5 py-[1px] text-left">
              {r.penalties.map((p, i) => (
                <span
                  key={i}
                  className={cn(
                    'mr-1.5 font-semibold',
                    p.kind === 'reprimand' || p.servedNow ? 'text-faint' : 'text-pit'
                  )}
                  title={`${p.text} – ${p.reason}${p.servedNow ? ' (served)' : ''}`}
                >
                  {penaltyLabel(p)}
                  {p.servedNow ? ' ✓' : ''}
                </span>
              ))}
            </td>
            <td className={cn(td, r.pending ? 'text-text' : 'text-faint')}>{r.pending || ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Incidents({
  incidents,
  clockOf,
  name,
}: {
  incidents: IncidentNow[];
  clockOf: (time: number | null) => string;
  name: (code: string) => React.ReactNode;
}) {
  return (
    <div className="border-t border-line">
      {incidents.map((now, i) => {
        const { incident, status } = now;
        const decided = status === 'penalty' || status === 'reprimand';
        const closed = status === 'no_action' || status === 'no_investigation';
        return (
          <div
            key={i}
            onClick={() => now.changed != null && clock.seek(now.changed)}
            className="flex cursor-pointer gap-2 border-b border-line px-1.5 py-0.5 leading-snug hover:bg-raised"
            title={incident.events.map((e) => `${clockOf(e.time)} ${e.text}`).join('\n')}
          >
            <span className="w-9 shrink-0 text-faint">{clockOf(now.since)}</span>
            <span className="min-w-0 flex-1">
              <span className={cn('font-semibold', closed && 'text-dim')}>
                {incident.drivers.map(name)}
              </span>
              <span className="text-faint">{incident.place}</span>
              {incident.reason ? (
                <span className="block truncate text-dim">{incident.reason}</span>
              ) : null}
            </span>
            <span
              className={cn(
                'shrink-0 text-right text-[10px] font-semibold',
                decided && status === 'penalty'
                  ? 'text-pit'
                  : closed
                    ? 'text-faint'
                    : status === 'investigating'
                      ? 'text-text'
                      : 'text-dim'
              )}
            >
              {decided && now.decision ? now.decision : STATUS_LABEL[status]}
            </span>
          </div>
        );
      })}
    </div>
  );
}
