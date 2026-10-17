import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * The session clock: session time t in seconds, the one time axis of laps, telemetry, weather and
 * (converted) race control. Replay drives it now, live will later. Widgets read "the state at t"
 * and do not know which source is behind it.
 *
 * Outside React state, like the cursor bus: while playing it ticks every animation frame, and maps
 * update imperatively via subscribe(). Tables re-render at a set rate with useClockTime().
 */
export type ClockControls = {
  playing: boolean;
  speed: number;
  /** Session time of the first lap start and the last lap end; null before a session loads. */
  range: [number, number] | null;
};

export const SPEEDS = [0.5, 1, 2, 4, 8, 16, 32, 64] as const;

let time = 0;
let controls: ClockControls = { playing: false, speed: 1, range: null };
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
  if (controls.range && time >= controls.range[1]) {
    setControls({ playing: false });
    return;
  }
  emit();
  frame = requestAnimationFrame(tick);
}

export const clock = {
  time: () => time,
  controls: () => controls,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  seek(t: number) {
    time = clamp(t);
    emit();
  },
  play() {
    if (controls.playing || !controls.range) return;
    // Playing from the end starts over.
    if (time >= controls.range[1]) time = controls.range[0];
    last = performance.now();
    frame = requestAnimationFrame(tick);
    setControls({ playing: true });
  },
  pause() {
    cancelAnimationFrame(frame);
    if (controls.playing) setControls({ playing: false });
  },
  toggle() {
    if (controls.playing) clock.pause();
    else clock.play();
  },
  setSpeed(speed: number) {
    setControls({ speed });
  },
  /** One step up or down the SPEEDS list. */
  stepSpeed(direction: 1 | -1) {
    const i = SPEEDS.indexOf(controls.speed as (typeof SPEEDS)[number]);
    const next = SPEEDS[Math.min(Math.max(i + direction, 0), SPEEDS.length - 1)];
    setControls({ speed: next });
  },
  /** A new session: stop, and stand at `at` (by default the end, so everything is visible). */
  load(range: [number, number] | null, at?: number) {
    cancelAnimationFrame(frame);
    controls = { ...controls, playing: false, range };
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
