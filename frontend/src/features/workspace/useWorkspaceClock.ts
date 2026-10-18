import { useEffect } from 'react';
import { clock } from '@/store/clock';
import { useDashboards, type Workspace } from '@/store/dashboards';
import { sessionPath, useSessionKey } from '@/store/selection';

type Stand = { t: number; following: boolean; playing: boolean };

/**
 * Each workspace keeps its own place on the clock: the pitwall goes on where it was (and plays on,
 * or follows live again), analysis starts at the end of the session. A new session forgets both.
 */
export function useWorkspaceClock() {
  const key = useSessionKey();
  const path = key ? sessionPath(key) : null;
  useEffect(() => {
    const stands: Partial<Record<Workspace, Stand>> = {};
    return useDashboards.subscribe((state, prev) => {
      if (state.workspace === prev.workspace) return;
      const c = clock.controls();
      stands[prev.workspace] = { t: clock.time(), following: c.following, playing: c.playing };
      clock.pause();
      const back = stands[state.workspace];
      if (back) {
        clock.seek(back.t);
        if (back.following) clock.goLive();
        else if (back.playing) clock.play();
      } else if (state.workspace === 'analysis') {
        if (c.range) clock.seek(c.range[1]);
      } else if (c.live) clock.goLive();
    });
  }, [path]);
}
