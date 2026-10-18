import { useTimeline } from '@/api/queries';
import { PanelMessage } from '@/components/data/bits';
import { lapAt } from '@/lib/markers';
import { formatClock, sessionClockAt } from '@/lib/replay';
import { useClockTime } from '@/store/clock';
import { useSessionKey } from '@/store/selection';
import type { WidgetProps } from '../types';
import type { ClockConfig } from './widget';

const timeOfDay = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** The session clock in red digits: time remaining (qualifying, practice) or race time and lap. */
export function ClockWidget({ config }: WidgetProps<ClockConfig>) {
  const timeline = useTimeline();
  const key = useSessionKey();
  const t = useClockTime(200);
  const data = timeline.data;
  if (!data) return <PanelMessage>Loading…</PanelMessage>;

  const red = data.track_status.some((p) => p.status === 'red' && p.start <= t && t < p.end);
  let label: string;
  let digits: string;
  let stopped = false;
  if (data.kind === 'race') {
    label = `LAP ${lapAt(data, t)}/${data.total_laps ?? '–'}`;
    digits = formatClock(t - data.start);
  } else {
    const at = sessionClockAt(data.clock, t);
    const part = data.segments.findLast((s) => s.start <= t) ?? data.segments[0];
    label = part?.name ?? key?.session ?? '';
    // Counting down, a second shows until it is over (18:00, then 17:59).
    digits = at ? formatClock(Math.ceil(at.remaining - 1e-6)) : '';
    stopped = at != null && !at.running && at.remaining > 0;
  }
  const t0 = data.t0_utc ? Date.parse(data.t0_utc) : null;

  return (
    <div className="flex h-full items-center justify-center gap-3 px-2 tabular-nums">
      <div className="flex flex-col items-end text-[10px] font-semibold leading-tight">
        <span className="text-dim">{label}</span>
        {red ? <span className="text-pit">RED FLAG</span> : null}
        {!red && stopped ? <span className="text-faint">STOPPED</span> : null}
      </div>
      <span className="font-mono text-[28px] font-semibold leading-none text-pit">{digits}</span>
      {config.timeOfDay && t0 != null ? (
        <span className="text-[11px] text-faint" title="Time of day (your time zone)">
          {timeOfDay.format(new Date(t0 + t * 1000))}
        </span>
      ) : null}
    </div>
  );
}
