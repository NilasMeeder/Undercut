import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { sessionPath, useSessionKey } from '@/store/selection';
import type { LapRef } from '@/store/groups';
import {
  apiGet,
  type Circuit,
  type Comparison,
  type Lap,
  type SeasonEvents,
  type SessionDetail,
} from './client';

const HOUR = 60 * 60 * 1000;

export function useSeasonEvents(year: number) {
  return useQuery({
    queryKey: ['season', year, 'events'],
    queryFn: () => apiGet<SeasonEvents>(`/seasons/${year}/events`),
    staleTime: HOUR,
  });
}

/** Archived session data never changes, so session queries never go stale. */
function useSessionQuery<T>(resource: string, enabled = true) {
  const key = useSessionKey();
  return useQuery({
    queryKey: ['session', key, resource],
    queryFn: () => apiGet<T>(`${sessionPath(key!)}${resource}`),
    enabled: key != null && enabled,
    staleTime: Infinity,
  });
}

export const useSessionDetail = () => useSessionQuery<SessionDetail>('');
export const useLaps = () => useSessionQuery<Lap[]>('/laps');
export const useCircuit = () => useSessionQuery<Circuit>('/circuit');

export function useComparison(laps: LapRef[]) {
  const key = useSessionKey();
  const spec = laps.map((l) => `${l.driver}:${l.lap}`).join(',');
  return useQuery({
    queryKey: ['session', key, 'compare', spec],
    queryFn: () => apiGet<Comparison>(`${sessionPath(key!)}/compare?laps=${spec}`),
    enabled: key != null && laps.length > 0,
    staleTime: Infinity,
    // Keep showing the previous comparison while a new selection loads (no layout jump).
    placeholderData: keepPreviousData,
  });
}
