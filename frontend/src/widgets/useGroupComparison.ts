import { useMemo } from 'react';
import { useComparison, useSessionDetail } from '@/api/queries';
import { lapStyles } from '@/lib/timing';
import { useGroupLaps, type GroupId } from '@/store/groups';

/** The group's lap comparison plus a line style per lap. Shared by all chart/map widgets. */
export function useGroupComparison(group: GroupId) {
  const laps = useGroupLaps(group);
  const detail = useSessionDetail();
  const comparison = useComparison(laps);
  const data = laps.length > 0 ? comparison.data : undefined;
  const styles = useMemo(
    () => (data ? lapStyles(data.laps, detail.data?.drivers) : []),
    [data, detail.data]
  );
  return {
    laps,
    data,
    styles,
    detail: detail.data,
    isFetching: comparison.isFetching,
    error: comparison.error,
  };
}
