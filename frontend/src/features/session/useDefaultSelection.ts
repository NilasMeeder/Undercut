import { useEffect } from 'react';
import { useLaps } from '@/api/queries';
import { bestLaps } from '@/lib/timing';
import { useGroups } from '@/store/groups';

/** When a session loads with nothing selected, compare the two fastest laps in the blue group. */
export function useDefaultSelection() {
  const laps = useLaps();
  useEffect(() => {
    if (!laps.data) return;
    const { laps: groups, setLaps } = useGroups.getState();
    if (Object.values(groups).some((g) => g.length > 0)) return;
    const top = bestLaps(laps.data).slice(0, 2);
    if (top.length > 0)
      setLaps(
        'blue',
        top.map((l) => ({ driver: l.driver, lap: l.lap }))
      );
  }, [laps.data]);
}
