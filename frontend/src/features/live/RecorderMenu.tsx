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

/** REC in the top bar: start the live recorder for the session on now (or the next one, or every
 * session from now on), or stop it. The recorder is its own process, so a backend restart does not
 * stop a recording; an automatic one is started again after the Mac restarts. */
export function RecorderMenu() {
  const status = useRecorder();
  const act = useRecorderAction();
  const s = status.data;
  if (!s) return null;
  const recording = s.running && s.current != null;
  const waiting = s.running && s.current == null;
  const always = s.running && s.mode === 'always';
  // Automatic, but the backend cannot start it (signed out, or one runs in a terminal).
  const stalled = s.automatic && !s.running;
  const target = s.current ?? s.upcoming;

  const label = recording
    ? `REC ${s.current!.code}`
    : always
      ? 'REC AUTO'
      : waiting && s.upcoming
        ? `REC ${hourMinute.format(new Date(s.upcoming.start_utc))}`
        : stalled
          ? 'REC !'
          : 'REC';
  const title = recording
    ? `Recording ${name(s.current!)}${always ? ', then every next session' : ''}`
    : always && s.upcoming
      ? `Recording every session: next ${name(s.upcoming)}`
      : waiting && s.upcoming
        ? `Waiting to record ${name(s.upcoming)}`
        : stalled
          ? 'Automatic recording is on, but the recorder is not running'
          : 'Live recorder: not recording';

  return (
    <HeaderMenu
      title={title}
      width="w-80"
      buttonClassName={cn(
        'flex h-5 shrink-0 items-center gap-1 border px-1.5 text-[11px] font-semibold',
        recording
          ? 'border-pit text-pit'
          : stalled
            ? 'border-pit text-text'
            : 'border-line-strong text-faint hover:text-text'
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
              ? `Recording ${name(s.current!)} since ${hourMinute.format(new Date(s.since!))}.` +
                (always ? ' Then it waits for the next session.' : '')
              : waiting && s.upcoming
                ? `${always ? 'Recording every session. Next: ' : 'Waiting for '}${name(s.upcoming)}, ` +
                  `${when.format(new Date(s.upcoming.start_utc))}. Recording starts an hour before.`
                : stalled
                  ? 'Automatic recording is on, but the recorder is not running. It starts again ' +
                    'by itself once it can.'
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
          {s.running || stalled ? (
            <button
              type="button"
              className={action}
              disabled={act.isPending}
              onClick={() => act.mutate('stop')}
              title="Stops the recorder; what is recorded so far stays"
            >
              {s.automatic ? 'Stop (and stop recording automatically)' : 'Stop'}
            </button>
          ) : target ? (
            <>
              <button
                type="button"
                className={action}
                disabled={act.isPending || !s.signed_in}
                onClick={() => act.mutate('always')}
                title="Waits for each session and records it, until you stop it here. Starts again after the Mac restarts (once the backend runs)."
              >
                Record every session automatically
              </button>
              <button
                type="button"
                className={action}
                disabled={act.isPending || !s.signed_in}
                onClick={() => act.mutate(s.current ? 'now' : 'wait')}
              >
                {s.current
                  ? `Only ${name(target)}, now`
                  : `Only ${name(target)} (${when.format(new Date(target.start_utc))})`}
              </button>
            </>
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
            The recorder runs on its own: restarting the backend does not stop it. The Mac stays
            awake while it records and from 2 h before a session it waits for; a closed MacBook on
            battery sleeps anyway. In a terminal: <span className="font-mono">make live</span>.
          </p>
        </div>
      )}
    </HeaderMenu>
  );
}
