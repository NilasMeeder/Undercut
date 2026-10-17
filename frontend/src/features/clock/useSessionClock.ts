import { useEffect, useRef } from 'react';
import { useTimeline } from '@/api/queries';
import { clock } from '@/store/clock';
import { sessionPath, useSessionKey } from '@/store/selection';

/**
 * Keeps the clock on the selected session: a new session stands at its end; the same session
 * with a new timeline (live: more laps) only gets the longer range.
 */
export function useSessionClock() {
  const key = useSessionKey();
  const timeline = useTimeline();
  const loaded = useRef<string | null>(null);
  const path = key ? sessionPath(key) : null;
  useEffect(() => {
    const t = timeline.data;
    if (t && loaded.current === path) {
      clock.setRange([t.start, t.end]);
      return;
    }
    clock.load(t ? [t.start, t.end] : null);
    loaded.current = t ? path : null;
  }, [timeline.data, path]);
}
