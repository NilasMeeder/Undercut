import { useEffect, useMemo, useRef } from 'react';
import { Pause, Play } from 'lucide-react';
import type { SessionTimeline } from '@/api/client';
import { usePositionsStatus, usePreparePositions, useTimeline } from '@/api/queries';
import { HeaderMenu, headerButton } from '@/dashboard/HeaderMenu';
import { COLORS, TRACK_STATUS_COLORS } from '@/lib/colors';
import { formatClock, TRACK_STATUS_LABEL } from '@/lib/replay';
import { cn } from '@/lib/utils';
import { clock, SPEEDS, useClockControls, useClockTime } from '@/store/clock';

const timeOfDay = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function lapAt(timeline: SessionTimeline, t: number): number {
  let lap = 0;
  while (lap < timeline.lap_starts.length && timeline.lap_starts[lap] <= t) lap++;
  return Math.max(lap, 1);
}

/** Where the session is: lap or qualifying part, time since the start, time of day. */
function Readout({ timeline }: { timeline: SessionTimeline }) {
  const t = useClockTime(200);
  const status = timeline.track_status.find((p) => p.start <= t && t < p.end)?.status ?? 'green';
  const segment = timeline.segments.findLast((s) => s.start <= t);
  const t0 = timeline.t0_utc ? Date.parse(timeline.t0_utc) : null;
  return (
    <div className="flex shrink-0 items-baseline gap-2 tabular-nums">
      <span className="w-[68px] font-semibold">
        {timeline.kind === 'race'
          ? `LAP ${lapAt(timeline, t)}/${timeline.total_laps}`
          : (segment?.name ?? (timeline.kind === 'practice' ? 'PRACTICE' : ''))}
      </span>
      <span className="w-[52px] text-right text-dim" title="Time since the first lap started">
        {formatClock(t - timeline.start)}
      </span>
      {t0 != null ? (
        <span className="text-faint" title="Time of day (your time zone)">
          {timeOfDay.format(new Date(t0 + t * 1000))}
        </span>
      ) : null}
      <span
        className="w-[72px] text-[10px] font-semibold"
        style={{ color: status === 'green' ? undefined : TRACK_STATUS_COLORS[status] }}
      >
        {status === 'green' ? '' : TRACK_STATUS_LABEL[status]}
      </span>
    </div>
  );
}

/**
 * The session as a bar: track status behind it, a tick per lap (race) or the qualifying parts,
 * the played part, and the clock as a white line. Click or drag to scrub.
 */
function Scrubber({ timeline }: { timeline: SessionTimeline }) {
  const ref = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const playedRef = useRef<HTMLDivElement>(null);
  const { start, end } = timeline;
  const span = end - start || 1;
  const pct = (t: number) => `${(((t - start) / span) * 100).toFixed(3)}%`;

  useEffect(() => {
    const update = () => {
      const at = pct(clock.time());
      if (handleRef.current) handleRef.current.style.left = at;
      if (playedRef.current) playedRef.current.style.width = at;
    };
    update();
    return clock.subscribe(update);
  });

  const seekTo = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    clock.seek(start + ((clientX - box.left) / box.width) * span);
  };

  const ticks = useMemo(
    () =>
      timeline.lap_starts.map((t, i) => ({
        t,
        major: (i + 1) % 10 === 0,
        label: i + 1,
      })),
    [timeline.lap_starts]
  );

  return (
    <div
      ref={ref}
      className="relative h-5 min-w-0 flex-1 cursor-pointer select-none border border-line bg-panel"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        seekTo(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) seekTo(e.clientX);
      }}
      title="Click or drag to move the session clock"
    >
      {timeline.track_status
        .filter((p) => p.status !== 'green')
        .map((p) => (
          <div
            key={p.start}
            className="absolute inset-y-0 opacity-30"
            style={{
              left: pct(p.start),
              width: pct(start + (p.end - p.start)),
              background: TRACK_STATUS_COLORS[p.status],
            }}
            title={TRACK_STATUS_LABEL[p.status]}
          />
        ))}
      {timeline.segments.map((s) => (
        <div
          key={s.name}
          className="absolute inset-y-0 border-x border-line-strong"
          style={{ left: pct(s.start), width: pct(start + (s.end - s.start)) }}
        >
          <span className="absolute left-1 top-0 text-[9px] leading-[18px] text-faint">
            {s.name}
          </span>
        </div>
      ))}
      {ticks.map((tick) => (
        <div
          key={tick.label}
          className="absolute bottom-0 w-px"
          style={{
            left: pct(tick.t),
            height: tick.major ? '100%' : '30%',
            background: tick.major ? COLORS.lineStrong : COLORS.line,
          }}
        >
          {tick.major ? (
            <span className="absolute left-0.5 top-0 text-[9px] leading-[18px] text-faint">
              {tick.label}
            </span>
          ) : null}
        </div>
      ))}
      <div ref={playedRef} className="absolute bottom-0 left-0 h-[2px] bg-dim" />
      <div ref={handleRef} className="absolute inset-y-[-2px] w-[2px] -translate-x-px bg-text" />
    </div>
  );
}

function PositionsState() {
  const status = usePositionsStatus();
  const prepare = usePreparePositions();
  const s = status.data;
  if (!s) return null;
  if (s.state === 'loading')
    return (
      <div className="flex shrink-0 items-center gap-1.5 text-faint" title={s.phase ?? undefined}>
        <span>{s.phase === 'Building position track' ? 'Building' : 'Telemetry'}</span>
        <div className="h-1.5 w-20 bg-raised">
          <div className="h-full bg-dim" style={{ width: `${Math.round(s.progress * 100)}%` }} />
        </div>
        <span className="w-7 text-right tabular-nums">{Math.round(s.progress * 100)}%</span>
      </div>
    );
  if (s.state === 'ready') return <span className="shrink-0 text-faint">Positions ready</span>;
  return (
    <button
      type="button"
      onClick={() => void prepare()}
      title={
        s.state === 'error'
          ? `Failed: ${s.error}. Click to try again.`
          : 'Download the telemetry of every lap once (about 10 s for a race), for the cars on the ' +
            'track map and the track line'
      }
      className={cn(
        'shrink-0 border border-line-strong px-1.5 hover:text-text',
        s.state === 'error' ? 'text-pit' : 'text-dim'
      )}
    >
      {s.state === 'error' ? 'Positions failed, retry' : 'Load positions'}
    </button>
  );
}

/** The session clock at the bottom of the screen: play, speed, where we are, scrub. */
export function ClockBar() {
  const timeline = useTimeline();
  const { playing, speed } = useClockControls();
  if (!timeline.data) return null;
  return (
    <footer className="flex h-7 shrink-0 items-center gap-2 border-t border-line bg-header px-1 text-[11px]">
      <button
        type="button"
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={() => clock.toggle()}
        className={cn(headerButton, 'text-text')}
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <HeaderMenu
        icon={<span className="text-[11px] tabular-nums text-dim">{speed}×</span>}
        title="Playback speed (- and =)"
        align="left"
        side="above"
        width="w-16"
      >
        {(close) => (
          <div className="py-0.5">
            {[...SPEEDS].reverse().map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  clock.setSpeed(s);
                  close();
                }}
                className={cn(
                  'block w-full px-2 py-0.5 text-right tabular-nums hover:bg-raised',
                  s === speed ? 'text-text' : 'text-dim'
                )}
              >
                {s}×
              </button>
            ))}
          </div>
        )}
      </HeaderMenu>
      <Readout timeline={timeline.data} />
      <Scrubber timeline={timeline.data} />
      <PositionsState />
    </footer>
  );
}
