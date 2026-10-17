import { useCallback, useEffect, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { clock } from '@/store/clock';
import { sessionPath, useSessionKey } from '@/store/selection';
import type { LapRef } from '@/store/groups';
import {
  apiGet,
  apiPost,
  type Circuit,
  type Comparison,
  type Lap,
  type RaceControlMessage,
  type ReplayPositions,
  type ReplayStatus,
  type SeasonEvents,
  type SessionDetail,
  type SessionTimeline,
  type TimingState,
  type Weather,
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
export const useRaceControl = () => useSessionQuery<RaceControlMessage[]>('/race-control');
export const useWeather = () => useSessionQuery<Weather>('/weather');

export type CompareOptions = {
  /** Grid spacing in metres. */
  step?: number;
  miniSectors?: number;
};

export function useComparison(laps: LapRef[], { step = 5, miniSectors = 25 }: CompareOptions = {}) {
  const key = useSessionKey();
  const spec = laps.map((l) => `${l.driver}:${l.lap}`).join(',');
  const query = `laps=${spec}&step=${step}&mini_sectors=${miniSectors}`;
  return useQuery({
    queryKey: ['session', key, 'compare', query],
    queryFn: () => apiGet<Comparison>(`${sessionPath(key!)}/compare?${query}`),
    enabled: key != null && laps.length > 0,
    staleTime: Infinity,
    // Keep showing the previous comparison while a new selection loads (no layout jump).
    placeholderData: keepPreviousData,
  });
}

export const useTimeline = () => useSessionQuery<SessionTimeline>('/timeline');

function covers(state: TimingState, t: number): boolean {
  return (
    (state.valid_from == null || t >= state.valid_from) &&
    (state.valid_until == null || t < state.valid_until)
  );
}

const TIMING_MIN_INTERVAL = 100;

/**
 * The timing tower at the session clock. Each answer says until when it holds, so a new one is
 * only fetched when the clock leaves that window (at most every 100 ms, the latest t wins).
 */
export function useTimingState(): { data: TimingState | undefined; error: Error | null } {
  const key = useSessionKey();
  const path = key ? sessionPath(key) : null;
  // Keyed by session, so a new session never shows the previous one's tower.
  const [result, setResult] = useState<{
    path: string | null;
    data?: TimingState;
    error: Error | null;
  }>({ path: null, error: null });

  useEffect(() => {
    if (!path) return;
    let current: TimingState | undefined;
    let busy = false;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastFetch = 0;
    let disposed = false;

    const check = () => {
      const t = clock.time();
      if (current && covers(current, t)) return;
      if (busy || timer) {
        again = true;
        return;
      }
      const wait = lastFetch + TIMING_MIN_INTERVAL - performance.now();
      if (wait > 0) {
        timer = setTimeout(() => {
          timer = undefined;
          check();
        }, wait);
        return;
      }
      busy = true;
      lastFetch = performance.now();
      apiGet<TimingState>(`${path}/timing?t=${t.toFixed(3)}`)
        .then((state) => {
          if (disposed) return;
          current = state;
          setResult({ path, data: state, error: null });
        })
        .catch((error: Error) => !disposed && setResult({ path, error }))
        .finally(() => {
          busy = false;
          if (again && !disposed) {
            again = false;
            check();
          }
        });
    };

    check();
    const unsubscribe = clock.subscribe(check);
    return () => {
      disposed = true;
      unsubscribe();
      clearTimeout(timer);
    };
  }, [path]);

  return result.path === path
    ? { data: result.data, error: result.error }
    : { data: undefined, error: null };
}

/** Whether the position track (every car, whole session) is ready; polls while it is built. */
export function usePositionsStatus() {
  const key = useSessionKey();
  return useQuery({
    queryKey: ['session', key, 'positions-status'],
    queryFn: () => apiGet<ReplayStatus>(`${sessionPath(key!)}/positions/status`),
    enabled: key != null,
    refetchInterval: (query) => (query.state.data?.state === 'loading' ? 400 : false),
  });
}

export function usePreparePositions() {
  const key = useSessionKey();
  const client = useQueryClient();
  return useCallback(async () => {
    if (!key) return;
    const status = await apiPost<ReplayStatus>(`${sessionPath(key)}/positions/prepare`);
    client.setQueryData(['session', key, 'positions-status'], status);
  }, [key, client]);
}

/** Car positions on a time grid, as typed arrays (NaN = not on track). */
export type PositionTrack = {
  start: number;
  step: number;
  count: number;
  lapLength: number;
  cars: { driver: string; x: Float32Array; y: Float32Array; progress: Float32Array }[];
};

const toFloats = (values: (number | null)[]) => Float32Array.from(values, (v) => v ?? NaN);

function toTrack(data: ReplayPositions): PositionTrack {
  return {
    start: data.start,
    step: data.step,
    count: data.count,
    lapLength: data.lap_length,
    cars: data.cars.map((c) => ({
      driver: c.driver,
      x: toFloats(c.x),
      y: toFloats(c.y),
      progress: toFloats(c.progress),
    })),
  };
}

/**
 * The position track for replay widgets. Mounting one starts the preparation (a one-time download
 * of the session's telemetry, shown with progress in the clock bar).
 */
export function useReplayPositions() {
  const key = useSessionKey();
  const status = usePositionsStatus();
  const prepare = usePreparePositions();
  const state = status.data?.state;

  useEffect(() => {
    if (state === 'missing') void prepare();
  }, [state, prepare]);

  const positions = useQuery({
    queryKey: ['session', key, 'positions'],
    queryFn: () => apiGet<ReplayPositions>(`${sessionPath(key!)}/positions`),
    enabled: key != null && state === 'ready',
    staleTime: Infinity,
    select: toTrack,
  });
  return { status: status.data, track: positions.data, error: status.error ?? positions.error };
}
