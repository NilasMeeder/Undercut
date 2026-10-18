import { useEffect } from 'react';
import { useLaps } from '@/api/queries';
import { followLatest } from '@/lib/laps';
import { useClockTime } from '@/store/clock';
import { GROUP_IDS, useGroups } from '@/store/groups';
import { useLiveInfo } from '@/store/live';

/** Live, a lap's telemetry is written a moment after the line (once the positions around it are
 * in, live/service.py): follow a lap only this long after it finished. */
const LIVE_MARGIN = 4;

/**
 * Moves the laps of following groups along with the clock (lib/laps.ts followLatest): live
 * every new lap, in a replay as the clock passes the line. A component of its own that renders
 * nothing, so the clock ticks do not re-render the app.
 */
export function FollowLatest() {
  const follow = useGroups((s) => s.follow);
  const laps = useLaps();
  const live = useLiveInfo()?.state === 'live';
  const t = useClockTime(500);

  useEffect(() => {
    if (!laps.data) return;
    const { laps: selected, followTo } = useGroups.getState();
    for (const group of GROUP_IDS) {
      if (!follow[group] || selected[group].length === 0) continue;
      const next = followLatest(laps.data, selected[group], t - (live ? LIVE_MARGIN : 0));
      if (next !== selected[group]) followTo(group, next);
    }
  }, [follow, laps.data, t, live]);

  return null;
}
