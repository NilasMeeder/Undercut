import { useSeasonEvents, useTimeline } from '@/api/queries';
import { PanelMessage } from '@/components/data/bits';
import { SegmentDisplay } from '@/components/data/SegmentDisplay';
import { lapAt } from '@/lib/markers';
import { formatClock, sessionClockAt } from '@/lib/replay';
import { useClockTime } from '@/store/clock';
import { useSessionKey } from '@/store/selection';
import type { WidgetProps } from '../types';
import type { ClockConfig } from './widget';

const pad = (n: number) => String(n).padStart(2, '0');

/** h:mm:ss, also under an hour (0:17:59), so the digits keep their places. */
function hms(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** UTC offset in minutes as UTC+2, UTC−5, UTC+5:30. */
function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? '−' : '+';
  const m = Math.abs(minutes);
  return `UTC${sign}${Math.floor(m / 60)}${m % 60 ? `:${pad(m % 60)}` : ''}`;
}

/** The circuit's UTC offset for the open session, from the calendar. */
function useUtcOffset(): number | null {
  const key = useSessionKey();
  const events = useSeasonEvents(key?.year ?? 0);
  if (!key) return null;
  const event = events.data?.events.find((e) => e.round === key.round);
  return event?.sessions.find((s) => s.code === key.session)?.utc_offset ?? null;
}

/** A digital clock: local time at the circuit or the session clock, the other one small beside it. */
export function ClockWidget({ config, setConfig }: WidgetProps<ClockConfig>) {
  const timeline = useTimeline();
  const key = useSessionKey();
  const offset = useUtcOffset();
  const t = useClockTime(200);
  const data = timeline.data;
  if (!data) return <PanelMessage>Loading…</PanelMessage>;

  const red = data.track_status.some((p) => p.status === 'red' && p.start <= t && t < p.end);
  let label: string;
  let session: number | null; // seconds on the session clock
  let stopped = false;
  if (data.kind === 'race') {
    label = `LAP ${lapAt(data, t)}/${data.total_laps ?? '–'}`;
    session = t - data.start;
  } else {
    const at = sessionClockAt(data.clock, t);
    const part = data.segments.findLast((s) => s.start <= t) ?? data.segments[0];
    label = part?.name ?? key?.session ?? '';
    // Counting down, a second shows until it is over (18:00, then 17:59).
    session = at ? Math.ceil(at.remaining - 1e-6) : null;
    stopped = at != null && !at.running && at.remaining > 0;
  }
  const t0 = data.t0_utc ? Date.parse(data.t0_utc) : null;
  // Local time of day in seconds since midnight at the circuit.
  const local =
    t0 != null && offset != null ? (((t0 / 1000 + t + offset * 60) % 86400) + 86400) % 86400 : null;

  // Without a local time (no offset or t0) the session clock is all there is.
  const mode = local == null ? 'session' : config.mode;
  const big = mode === 'local' ? local : session;
  const small = mode === 'local' ? session : local;
  const smallTitle =
    mode === 'local'
      ? data.kind === 'race'
        ? 'Race time'
        : 'Time remaining'
      : `Local time at the circuit (${offset != null ? offsetLabel(offset) : ''})`;

  return (
    <div className="flex h-full items-center gap-3 px-2 py-1.5 tabular-nums">
      <div className="flex w-14 shrink-0 flex-col items-end text-[10px] font-semibold leading-tight">
        <span className="text-dim">{label}</span>
        {red ? <span className="text-pit">RED FLAG</span> : null}
        {!red && stopped ? <span className="text-faint">STOPPED</span> : null}
      </div>
      <div className="flex h-full min-w-0 flex-1 items-center justify-center text-pit">
        {big != null ? <SegmentDisplay text={hms(big)} className="h-full w-full" /> : null}
      </div>
      <div className="flex w-14 shrink-0 flex-col items-start text-[10px] leading-tight">
        <button
          type="button"
          disabled={local == null}
          onClick={() => setConfig({ mode: mode === 'local' ? 'session' : 'local' })}
          title={
            local == null
              ? 'No local time for this session'
              : mode === 'local'
                ? `Local time at the circuit (${offsetLabel(offset!)}). Click for the session clock`
                : 'Session clock. Click for the local time at the circuit'
          }
          className="font-semibold text-faint hover:text-text disabled:hover:text-faint"
        >
          {mode === 'local' ? 'LOCAL' : 'SESSION'}
        </button>
        {small != null ? (
          <span className="text-dim" title={smallTitle}>
            {mode === 'local' ? formatClock(small) : hms(small)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
