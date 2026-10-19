import { useEffect, useRef } from 'react';
import { clock } from '@/store/clock';

/** Session seconds an event may lag the clock and still count: live data arrives a few seconds
 * after the moment it is about. */
export const LOOKBACK = 30;
const TICK = 250;

/**
 * Calls `onPass` with the items (in time order) the session clock just ran past, playing or
 * live; each item once. A seek or a jump of the clock (also back, or further than the speed
 * allows) passes nothing: what lies before the new time counts as seen. A new `reset` (a key
 * for the session and settings) starts over the same way and calls `onReset`.
 */
export function useClockPassing<T extends { key: string; time: number }>(
  items: T[],
  reset: string,
  onPass: (fresh: T[]) => void,
  onReset?: () => void
) {
  const list = useRef(items);
  const resetRef = useRef(reset);
  const handlers = useRef({ onPass, onReset });
  const seen = useRef(new Set<string>());
  const last = useRef<{ t: number; wall: number; reset: string } | null>(null);
  useEffect(() => {
    list.current = items;
    resetRef.current = reset;
    handlers.current = { onPass, onReset };
  });

  useEffect(() => {
    const tick = () => {
      const now = clock.time();
      const wall = performance.now();
      let prev = last.current;
      if (prev && prev.reset !== resetRef.current) {
        prev = null;
        handlers.current.onReset?.();
      }
      last.current = { t: now, wall, reset: resetRef.current };
      const allowed = prev ? ((wall - prev.wall) / 1000) * clock.controls().speed * 2 + 3 : 0;
      const jumped = !prev || now < prev.t - 0.5 || now - prev.t > allowed;
      // After a jump (also back) exactly what lies before the new time counts as seen.
      if (jumped) seen.current = new Set();
      const fresh: T[] = [];
      for (const item of list.current) {
        if (item.time > now) break;
        if (seen.current.has(item.key)) continue;
        seen.current.add(item.key);
        if (!jumped && item.time > now - LOOKBACK) fresh.push(item);
      }
      if (fresh.length > 0) handlers.current.onPass(fresh);
    };
    const timer = setInterval(tick, TICK);
    return () => clearInterval(timer);
  }, []);
}
