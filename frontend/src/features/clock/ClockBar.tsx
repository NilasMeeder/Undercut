import { useEffect, useMemo, useRef, useState } from 'react';
import { Flag, Pause, Play } from 'lucide-react';
import type { Marker, SessionTimeline } from '@/api/client';
import { useMarkers } from '@/api/markers';
import { usePositionsStatus, usePreparePositions, useTimeline } from '@/api/queries';
import { HeaderMenu, headerButton } from '@/dashboard/HeaderMenu';
import { followsClock } from '@/dashboard/layout';
import { COLORS, TRACK_STATUS_COLORS } from '@/lib/colors';
import { lapAt, markerLabel, markerLap } from '@/lib/markers';
import { formatClock, TRACK_STATUS_LABEL } from '@/lib/replay';
import { cn } from '@/lib/utils';
import { useAtClock, useAtClockOn } from '@/store/atClock';
import { clock, SPEEDS, useClockControls, useClockTime } from '@/store/clock';
import { useDashboards } from '@/store/dashboards';
import { editMarker, markNew } from '@/store/markerEditor';

/** A moment counts as "now" this long after it, so its note can be read while playing. */
const MOMENT_SHOWN = 8;

const timeLabel = (m: Marker) =>
  [markerLap(m), markerLabel(m)].filter(Boolean).join(' · ') || 'Marker';

const timeOfDay = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** Where the session is: lap or qualifying part, time since the start, time of day. */
function Readout({ timeline, marks }: { timeline: SessionTimeline; marks: Marker[] }) {
  const t = useClockTime(200);
  const now = marks.filter((m) => m.start <= t && t <= (m.end ?? m.start + MOMENT_SHOWN));
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
      {/* A fixed slot (only with time markers), so the bar does not jump while playing. */}
      {marks.length > 0 ? (
        <span className="w-[220px] truncate text-dim" title={now.map(timeLabel).join('\n')}>
          {now.length > 0 ? (
            <>
              <span className="mr-1 text-[10px] uppercase text-faint">Mark</span>
              {timeLabel(now[0])}
            </>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The session as a bar: track status behind it, a tick per lap (race) or the qualifying parts,
 * the played part, and the clock as a white line. Click or drag to scrub.
 */
function Scrubber({ timeline, marks }: { timeline: SessionTimeline; marks: Marker[] }) {
  const ref = useRef<HTMLDivElement>(null);
  // Shift + drag marks a time range: from where the drag started to where it is now.
  const [range, setRange] = useState<[number, number] | null>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const playedRef = useRef<HTMLDivElement>(null);
  // The clock's range: live, it runs on to the newest data.
  const { range: clockRange } = useClockControls();
  const [start, end] = clockRange ?? [timeline.start, timeline.end];
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

  const timeAt = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return start;
    const t = start + ((clientX - box.left) / box.width) * span;
    return Math.min(Math.max(t, start), end);
  };
  const seekTo = (clientX: number) => clock.seek(timeAt(clientX));

  const ticks = useMemo(
    () =>
      timeline.lap_starts.map((t, i) => ({
        t,
        major: (timeline.first_lap + i) % 10 === 0,
        label: timeline.first_lap + i,
      })),
    [timeline.lap_starts, timeline.first_lap]
  );

  return (
    <div
      ref={ref}
      className="relative h-5 min-w-0 flex-1 cursor-pointer select-none border border-line bg-panel"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        if (e.shiftKey) {
          const t = timeAt(e.clientX);
          setRange([t, t]);
        } else seekTo(e.clientX);
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        if (range) setRange([range[0], timeAt(e.clientX)]);
        else seekTo(e.clientX);
      }}
      onPointerUp={() => {
        if (!range) return;
        const [a, b] = [Math.min(...range), Math.max(...range)];
        setRange(null);
        markNew({ kind: 'time', start: a, end: b - a > 1 ? b : null });
      }}
      title="Click or drag to move the session clock. Shift + drag marks a time range."
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
      {marks.map((m) => (
        <div
          key={m.id}
          className="absolute inset-y-0 min-w-[3px] cursor-pointer border-x border-dim bg-marker-fill"
          style={{ left: pct(m.start), width: pct(start + ((m.end ?? m.start) - m.start)) }}
          title={`${timeLabel(m)}. Click to go there, double-click to edit or delete.`}
          onPointerDown={(e) => {
            if (e.shiftKey) return;
            e.stopPropagation();
            clock.seek(m.start);
          }}
          onDoubleClick={() => editMarker(m)}
        />
      ))}
      {range ? (
        <div
          className="absolute inset-y-0 bg-marker-fill"
          style={{
            left: pct(Math.min(...range)),
            width: pct(start + Math.abs(range[1] - range[0])),
          }}
        />
      ) : null}
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

/** The switch: laps, bests, speed traps and the run timeline only as far as the clock (c). */
function AtClockSwitch() {
  const on = useAtClock((s) => s.on);
  const setOn = useAtClock((s) => s.setOn);
  // The pitwall always shows the session as far as the clock.
  if (useDashboards((s) => s.workspace === 'pitwall')) return null;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => setOn(!on)}
      title={
        on
          ? 'Only what had happened at the clock: laps, bests, speed traps and run timeline (c). ' +
            'Click for the whole session. Panels can override this in their settings.'
          : 'Showing the whole session in laps, bests, speed traps and run timeline. Click to show ' +
            'only what had happened at the clock (c).'
      }
      className={cn(
        'h-5 shrink-0 border px-1 text-[9px] font-semibold tracking-wider',
        on
          ? 'border-line-strong bg-raised text-text'
          : 'border-transparent text-faint hover:text-text'
      )}
    >
      AT CLOCK
    </button>
  );
}

const DELAYS = [0, 2, 5, 10, 15, 20, 30, 45, 60] as const;

/** Live: back to the live edge, and how far behind it to play (to match the TV picture). */
function LiveControl() {
  const { live, following, delay } = useClockControls();
  if (!live) return null;
  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        onClick={() => clock.goLive()}
        title={following ? 'Following the live feed' : 'Back to live (End)'}
        className={cn(
          'flex items-center gap-1 border px-1.5 font-semibold',
          following ? 'border-pit text-pit' : 'border-line-strong text-dim hover:text-text'
        )}
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', following ? 'bg-pit' : 'bg-faint')} />
        LIVE
      </button>
      <HeaderMenu
        icon={<span className="text-[11px] tabular-nums text-dim">−{delay}s</span>}
        title="Delay behind the live feed, to line up with the TV picture"
        align="right"
        side="above"
        width="w-20"
      >
        {(close) => (
          <div className="py-0.5">
            {DELAYS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  clock.setDelay(d);
                  close();
                }}
                className={cn(
                  'block w-full px-2 py-0.5 text-right tabular-nums hover:bg-raised',
                  d === delay ? 'text-text' : 'text-dim'
                )}
              >
                {d === 0 ? 'No delay' : `${d} s`}
              </button>
            ))}
          </div>
        )}
      </HeaderMenu>
    </div>
  );
}

/**
 * Playing on a dashboard where no panel follows the clock (the analysis presets) shows nothing
 * moving, so say so, with a way to the pitwall (its board, or a new one there).
 */
function NothingFollows() {
  const tabs = useDashboards((s) => s.tabs);
  const active = useDashboards((s) => s.active);
  const workspace = useDashboards((s) => s.workspace);
  useAtClockOn(); // analysis panels follow the clock when the switch is on
  const tab = tabs.find((t) => t.id === active);
  if (!tab || followsClock(tab)) return null;
  const openPitwall = () => {
    const { add, setWorkspace } = useDashboards.getState();
    if (workspace === 'pitwall') add('Pitwall', 'pitwall');
    else setWorkspace('pitwall');
  };
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-faint">
      No panel here follows the clock
      <button
        type="button"
        onClick={openPitwall}
        className="border border-line-strong px-1.5 text-text hover:bg-raised"
      >
        Open Pitwall
      </button>
    </span>
  );
}

/** The session clock at the bottom of the screen: play, speed, where we are, scrub. */
export function ClockBar() {
  const timeline = useTimeline();
  const markers = useMarkers();
  const marks = useMemo(
    () => (markers.data ?? []).filter((m) => m.kind === 'time'),
    [markers.data]
  );
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
      <button
        type="button"
        title="Mark this moment (Shift+M). Shift + drag on the bar marks a range."
        aria-label="Mark this moment"
        onClick={() => markNew({ kind: 'time', start: clock.time() })}
        className={headerButton}
      >
        <Flag className="h-3 w-3" />
      </button>
      <AtClockSwitch />
      <Readout timeline={timeline.data} marks={marks} />
      {playing ? <NothingFollows /> : null}
      <Scrubber timeline={timeline.data} marks={marks} />
      <LiveControl />
      <PositionsState />
    </footer>
  );
}
