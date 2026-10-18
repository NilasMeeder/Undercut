import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * The session clock: session time t in seconds, the one time axis of laps, telemetry, weather and
 * (converted) race control. Replay and live drive it the same way: widgets read "the state at t"
 * and do not know which source is behind it.
 *
 * Live: the end of the range moves with the newest data (`setLiveEdge`). Following live, the clock
 * plays at 1× a set delay behind that edge; any seek, pause or speed change stops following, and
 * `goLive` picks it up again. A paused clock at the end stays at the end (analysis: everything).
 *
 * Outside React state, like the cursor bus: while playing it ticks every animation frame, and maps
 * update imperatively via subscribe(). Tables re-render at a set rate with useClockTime().
 */
export type ClockControls = {
  playing: boolean;
  speed: number;
  /** Session time of the first lap start and the last lap end (live: the newest data); null
   * before a session loads. */
  range: [number, number] | null;
  /** The session is live: the end of the range still moves. */
  live: boolean;
  /** Playing at the live edge (minus the delay). */
  following: boolean;
  /** Seconds behind the live edge, to line up with the TV picture. */
  delay: number;
};

export const SPEEDS = [0.5, 1, 2, 4, 8, 16, 32, 64] as const;

let time = 0;
const DELAY_KEY = 'f1dash-live-delay';
/** Off by more than this behind the edge while following: jump instead of drifting back. */
const FOLLOW_SLACK = 3;

function storedDelay(): number {
  try {
    return Number(localStorage.getItem(DELAY_KEY)) || 0;
  } catch {
    return 0;
  }
}

let controls: ClockControls = {
  playing: false,
  speed: 1,
  range: null,
  live: false,
  following: false,
  delay: storedDelay(),
};
const listeners = new Set<() => void>();
let frame = 0;
let last = 0;
/** Where to stand once the next session's range arrives (a saved view of another session). */
let pending: number | null = null;

function emit() {
  listeners.forEach((fn) => fn());
}

function setControls(next: Partial<ClockControls>) {
  controls = { ...controls, ...next };
  emit();
}

function clamp(t: number): number {
  const range = controls.range;
  return range ? Math.min(Math.max(t, range[0]), range[1]) : t;
}

function tick(now: number) {
  const elapsed = Math.min((now - last) / 1000, 0.25); // a background tab must not jump ahead
  last = now;
  time = clamp(time + elapsed * controls.speed);
  // Live: the edge moves on with the next data; wait there instead of stopping.
  if (controls.range && time >= controls.range[1] && !controls.following) {
    setControls({ playing: false });
    return;
  }
  emit();
  frame = requestAnimationFrame(tick);
}

function start() {
  last = performance.now();
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(tick);
}

/** Standing still at the end: a longer range (live) takes the clock along. */
function atEnd(): boolean {
  return !controls.playing && controls.range != null && time >= controls.range[1] - 0.001;
}

/** Stop following live (any user action on the clock). */
function unfollow() {
  if (controls.following) controls = { ...controls, following: false };
}

export const clock = {
  time: () => time,
  controls: () => controls,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  seek(t: number) {
    unfollow();
    time = clamp(t);
    emit();
  },
  play() {
    if (controls.playing || !controls.range) return;
    unfollow();
    // Playing from the end starts over.
    if (time >= controls.range[1]) time = controls.range[0];
    start();
    setControls({ playing: true });
  },
  pause() {
    cancelAnimationFrame(frame);
    unfollow();
    if (controls.playing) setControls({ playing: false });
    else emit();
  },
  toggle() {
    if (controls.playing) clock.pause();
    else clock.play();
  },
  setSpeed(speed: number) {
    unfollow();
    setControls({ speed });
  },
  /** One step up or down the SPEEDS list. */
  stepSpeed(direction: 1 | -1) {
    const i = SPEEDS.indexOf(controls.speed as (typeof SPEEDS)[number]);
    const next = SPEEDS[Math.min(Math.max(i + direction, 0), SPEEDS.length - 1)];
    unfollow();
    setControls({ speed: next });
  },
  /** The same session with a longer range (new laps while live): time and play state stay. */
  setRange(range: [number, number]) {
    const end = controls.live ? Math.max(range[1], controls.range?.[1] ?? range[1]) : range[1];
    if (atEnd()) time = end;
    setControls({ range: [range[0], end] });
  },
  /** Live: the newest data is at `edge` (null = the session is not live, or no longer). */
  setLiveEdge(edge: number | null) {
    if (edge == null) {
      if (controls.live) setControls({ live: false, following: false });
      return;
    }
    const range: [number, number] = controls.range
      ? [controls.range[0], Math.max(controls.range[1], edge)]
      : [edge, edge];
    if (atEnd()) time = range[1];
    controls = { ...controls, live: true, range };
    if (controls.following) {
      const target = edge - controls.delay;
      if (Math.abs(time - target) > FOLLOW_SLACK) time = clamp(target);
    }
    emit();
  },
  /** Play along with the live feed, `delay` seconds behind its edge. */
  goLive() {
    if (!controls.live || !controls.range) return;
    time = clamp(controls.range[1] - controls.delay);
    controls = { ...controls, following: true, speed: 1, playing: true };
    start();
    emit();
  },
  setDelay(delay: number) {
    try {
      localStorage.setItem(DELAY_KEY, String(delay));
    } catch {
      // per-viewer convenience only
    }
    setControls({ delay });
    if (controls.following) clock.goLive();
  },
  /** A new session: stop, and stand at `at` (by default the end, so everything is visible). */
  load(range: [number, number] | null, at?: number) {
    cancelAnimationFrame(frame);
    controls = { ...controls, playing: false, range, live: false, following: false };
    if (range && pending != null) {
      at = pending;
      pending = null;
    }
    time = range ? clamp(at ?? range[1]) : 0;
    emit();
  },
  /** Seek once the next session has loaded (its range is not known yet). */
  seekAfterLoad(t: number) {
    pending = t;
  },
};

/** Play state, speed and range: re-renders only when those change, not on every tick. */
export function useClockControls(): ClockControls {
  return useSyncExternalStore(clock.subscribe, clock.controls);
}

/** The clock time, re-rendering at most once per `interval` ms (and once more when it settles). */
export function useClockTime(interval = 250): number {
  const [value, setValue] = useState(clock.time);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shown = 0;
    const update = () => {
      if (timer) return;
      const wait = Math.max(0, shown + interval - performance.now());
      timer = setTimeout(() => {
        timer = undefined;
        shown = performance.now();
        setValue(clock.time());
      }, wait);
    };
    update();
    const unsubscribe = clock.subscribe(update);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [interval]);
  return value;
}
