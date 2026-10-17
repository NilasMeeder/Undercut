import { useEffect } from 'react';
import { useTimeline } from '@/api/queries';
import { clock } from '@/store/clock';

/** Keeps the clock on the selected session: its range, standing at the end. */
export function useSessionClock() {
  const timeline = useTimeline();
  useEffect(() => {
    const t = timeline.data;
    clock.load(t ? [t.start, t.end] : null);
  }, [timeline.data]);
}
