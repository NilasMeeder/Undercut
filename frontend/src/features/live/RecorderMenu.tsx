import type { ScheduledSession } from '@/api/client';
import { useRecorder, useRecorderAction } from '@/api/recorder';
import { HeaderMenu } from '@/dashboard/HeaderMenu';
import { cn } from '@/lib/utils';

const when = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const hourMinute = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

const name = (s: ScheduledSession) =>
  `${s.event_name.replace(/ Grand Prix$/, ' GP')} ${s.session_name}`;

const action =
  'w-full border border-line-strong px-2 py-1 text-left hover:bg-raised disabled:opacity-40';

/** REC in the top bar: start the live recorder for the session on now (or the next one), or stop
 * it. The recorder is its own process, so a backend restart does not stop a recording. */
export function RecorderMenu() {
  const status = useRecorder();
  const act = useRecorderAction();
  const s = status.data;
  if (!s) return null;
  const recording = s.running && s.current != null;
  const waiting = s.running && s.current == null;
  const target = s.current ?? s.upcoming;

  const label = recording
    ? `REC ${s.current!.code}`
    : waiting && s.upcoming
      ? `REC ${hourMinute.format(new Date(s.upcoming.start_utc))}`
      : 'REC';
  const title = recording
    ? `Recording ${name(s.current!)}`
    : waiting && s.upcoming
      ? `Waiting to record ${name(s.upcoming)}`
      : 'Live recorder: not recording';

  return (
    <HeaderMenu
      title={title}
      width="w-80"
      buttonClassName={cn(
        'flex h-5 shrink-0 items-center gap-1 border px-1.5 text-[11px] font-semibold',
        recording ? 'border-pit text-pit' : 'border-line-strong text-faint hover:text-text'
      )}
      icon={
        <>
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              recording ? 'bg-pit' : waiting ? 'border border-dim' : 'bg-faint'
            )}
          />
          {label}
        </>
      }
    >
      {() => (
        <div className="space-y-2 p-2">
          <div className="text-[10px] font-semibold tracking-wider text-dim">LIVE RECORDER</div>
          <p className="leading-snug text-text">
            {recording
              ? `Recording ${name(s.current!)} since ${hourMinute.format(new Date(s.since!))}.`
              : waiting && s.upcoming
                ? `Waiting for ${name(s.upcoming)}, ${when.format(new Date(s.upcoming.start_utc))}. ` +
                  'Recording starts an hour before.'
                : 'Not recording.'}
          </p>
          {!s.signed_in ? (
            <p className="leading-snug text-dim">
              Not signed in to F1 TV: without it the feed has no data. Once, in{' '}
              <span className="font-mono">backend/</span>:{' '}
              <span className="select-all font-mono text-text">
                uv run python -m fastf1 auth f1tv --authenticate
              </span>
            </p>
          ) : null}
          {s.running ? (
            <button
              type="button"
              className={action}
              disabled={act.isPending}
              onClick={() => act.mutate('stop')}
              title="Stops the recorder; what is recorded so far stays"
            >
              Stop
            </button>
          ) : target ? (
            <button
              type="button"
              className={action}
              disabled={act.isPending || !s.signed_in}
              onClick={() => act.mutate(s.current ? 'start' : 'wait')}
            >
              {s.current
                ? `Record ${name(target)} now`
                : `Record ${name(target)} when it starts (${when.format(new Date(target.start_utc))})`}
            </button>
          ) : (
            <p className="text-dim">No sessions left in the calendar.</p>
          )}
          {act.error ? <p className="text-pit">{act.error.message}</p> : null}
          {s.log.length > 0 ? (
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all border-t border-line pt-1.5 font-mono text-[10px] leading-snug text-faint">
              {s.log.join('\n')}
            </pre>
          ) : null}
          <p className="text-[10px] leading-snug text-faint">
            The recorder runs on its own: restarting the backend does not stop it. In a terminal:{' '}
            <span className="font-mono">make live</span>.
          </p>
        </div>
      )}
    </HeaderMenu>
  );
}
