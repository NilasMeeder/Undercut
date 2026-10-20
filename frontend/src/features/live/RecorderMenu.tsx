import type { RecorderStatus, ScheduledSession } from '@/api/client';
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

/** Seconds without a byte from F1 (it sends heartbeats) before the recording looks stuck. */
const STALE = 60;
const SIGN_IN_WARN_DAYS = 3;

type Health = NonNullable<RecorderStatus['health']>;

/** Seconds since the recording last grew, at the time of the status. */
const silentFor = (health: Health) => (Date.now() - Date.parse(health.last_write)) / 1000;

function duration(seconds: number) {
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} days`;
}

const ago = (seconds: number) => `${duration(seconds)} ago`;

/** How the recording of the session on now is doing: is data still coming in, how late, how
 * often the recorder had to reconnect. */
function HealthRows({ health }: { health: Health }) {
  const silent = silentFor(health);
  const lag = health.feed_utc
    ? (Date.parse(health.last_write) - Date.parse(health.feed_utc)) / 1000
    : null;
  const row = 'flex justify-between gap-2';
  return (
    <div className="space-y-0.5 border-t border-line pt-1.5 font-mono text-[11px]">
      <div className={row}>
        <span className="text-dim">Last data</span>
        <span className={silent > STALE ? 'text-pit' : 'text-text'}>{ago(silent)}</span>
      </div>
      <div className={row} title="When F1 sent the newest message against when it was written">
        <span className="text-dim">Feed delay</span>
        <span className={lag != null && lag > 5 ? 'text-slow' : 'text-text'}>
          {lag == null ? '—' : lag < 90 ? `${lag.toFixed(1)} s` : duration(lag)}
        </span>
      </div>
      <div className={row}>
        <span className="text-dim">Reconnects</span>
        <span className={health.reconnects > 0 ? 'text-slow' : 'text-text'}>
          {health.reconnects}
        </span>
      </div>
      <div className={row}>
        <span className="text-dim">Recorded</span>
        <span className="text-text">{(health.size / 1e6).toFixed(1)} MB</span>
      </div>
      {health.error ? <p className="text-pit">Converting failed: {health.error}</p> : null}
    </div>
  );
}

/** The F1 TV sign-in runs out: soon, or before the next session ends. */
function signInWarning(s: RecorderStatus) {
  if (!s.sign_in_expires) return null;
  const expires = Date.parse(s.sign_in_expires);
  const next = s.current ?? s.upcoming;
  const needed = next ? Date.parse(next.start_utc) + 4 * 3600_000 : Date.now();
  const soon = expires - Date.now() < SIGN_IN_WARN_DAYS * 86400_000 || expires < needed;
  return { expires, soon };
}

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
  const stale = recording && s.health != null && silentFor(s.health) > STALE;
  const signIn = signInWarning(s);

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
    ? `Recording ${name(s.current!)}${always ? ', then every next session' : ''}` +
      (stale ? `: no data for ${duration(silentFor(s.health!))}` : '')
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
        'flex h-5 shrink-0 items-center gap-1 whitespace-nowrap border px-1.5 text-[11px] font-semibold',
        recording
          ? stale
            ? 'border-pit bg-pit text-bg'
            : 'border-pit text-pit'
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
          {s.health ? <HealthRows health={s.health} /> : null}
          {s.signed_in && signIn ? (
            <p className={cn('leading-snug', signIn.soon ? 'text-slow' : 'text-faint')}>
              F1 TV sign-in valid until {when.format(new Date(signIn.expires))}
              {signIn.soon ? (
                <>
                  . Sign in again before then, in <span className="font-mono">backend/</span>:{' '}
                  <span className="select-all font-mono text-text">
                    uv run python -m fastf1 auth f1tv --authenticate
                  </span>
                </>
              ) : (
                '.'
              )}
            </p>
          ) : null}
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
