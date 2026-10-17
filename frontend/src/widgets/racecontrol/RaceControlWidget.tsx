import { useMemo } from 'react';
import type { RaceControlMessage } from '@/api/client';
import { useRaceControl, useSessionDetail } from '@/api/queries';
import { PanelMessage } from '@/components/data/bits';
import { FLAG_COLORS } from '@/lib/colors';
import { cn } from '@/lib/utils';
import { useClockTime } from '@/store/clock';
import { useGroupLaps, useLapSelection } from '@/store/groups';
import type { WidgetProps } from '../types';
import type { MessageKind, RaceControlConfig } from './widget';

const STEWARDS = /NOTED|INVESTIGATION|PENALTY|REVIEWED|NO FURTHER|REPRIMAND|SUMMONED/;

function kindOf(m: RaceControlMessage): MessageKind {
  if (/DELETED/.test(m.message)) return 'deleted';
  if (STEWARDS.test(m.message)) return 'stewards';
  if (m.category === 'Flag' || m.category === 'SafetyCar') return 'flags';
  return 'other';
}

/** The lap a deleted-lap message refers to, in the driver's own lap numbering. */
function deletedLap(m: RaceControlMessage): number | null {
  const match = /\bLAP (\d+)\b/.exec(m.message);
  return m.driver && match ? Number(match[1]) : null;
}

const timeOfDay = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function RaceControlWidget({ group, config }: WidgetProps<RaceControlConfig>) {
  const messages = useRaceControl();
  const detail = useSessionDetail();
  const groupLaps = useGroupLaps(group);
  const { isSelected, toggle } = useLapSelection(group);
  const now = useClockTime(500);
  const until = config.follow ? now : Infinity;

  const shown = useMemo(() => {
    const drivers = new Set(groupLaps.map((l) => l.driver));
    const list = (messages.data ?? []).filter(
      (m) =>
        (m.session_time == null || m.session_time <= until) &&
        config.kinds.includes(kindOf(m)) &&
        (config.scope === 'all' || m.driver == null || drivers.has(m.driver))
    );
    return config.order === 'newest' ? list.reverse() : list;
  }, [messages.data, config.kinds, config.scope, config.order, groupLaps, until]);

  if (messages.error) return <PanelMessage>{messages.error.message}</PanelMessage>;
  if (!messages.data) return <PanelMessage>Loading race control…</PanelMessage>;
  if (shown.length === 0)
    return (
      <PanelMessage>
        {config.follow && until < Infinity
          ? 'No messages (matching the filter) yet at the session clock.'
          : 'No messages match the filter.'}
      </PanelMessage>
    );

  const color = (code: string) => detail.data?.drivers.find((d) => d.code === code)?.color;
  return (
    <div className="h-full overflow-auto text-[11px]">
      {shown.map((m, i) => {
        const lap = kindOf(m) === 'deleted' ? deletedLap(m) : null;
        const ref = lap != null && m.driver ? { driver: m.driver, lap } : null;
        const selected = ref != null && isSelected(ref);
        return (
          <div
            key={`${m.utc}-${i}`}
            onClick={ref ? () => toggle(ref) : undefined}
            className={cn(
              'flex gap-2 border-b border-line px-1.5 py-0.5 leading-snug',
              ref && 'cursor-pointer hover:bg-raised',
              selected && 'bg-raised'
            )}
          >
            <span className="shrink-0 text-faint">{timeOfDay.format(new Date(m.utc))}</span>
            <span
              className="mt-[3px] h-2.5 w-2.5 shrink-0"
              style={{ background: m.flag ? FLAG_COLORS[m.flag] : undefined }}
              title={m.flag ?? undefined}
            />
            <span className="w-9 shrink-0 font-semibold">
              {m.driver ? (
                <>
                  <span
                    className="mr-1 inline-block h-2.5 w-[3px] align-[-1px]"
                    style={{ background: color(m.driver) }}
                  />
                  {m.driver}
                </>
              ) : null}
            </span>
            <span className={cn(kindOf(m) === 'other' ? 'text-dim' : 'text-text')}>
              {m.message}
              {m.lap != null ? <span className="text-faint"> · lap {m.lap}</span> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
