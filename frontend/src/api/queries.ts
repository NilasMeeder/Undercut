import { useCallback, useEffect, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { clock } from '@/store/clock';
import { useLiveInfo } from '@/store/live';
import { sessionPath, useSessionKey, type SessionKey } from '@/store/selection';
import type { LapRef } from '@/store/groups';
import {
  apiGet,
  apiPost,
  type Circuit,
  type Comparison,
  type Degradation,
  type EnergyComparison,
  type EnergySession,
  type SessionReport,
  type Lap,
  type LapProgress,
  type PitWindow,
  type RaceHistory,
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

/** Estimated energy deployment of the laps (2026): where they stop gaining at full throttle.
 * The first request for a session reads the telemetry of all its clean laps (seconds). */
/** `step`: also each lap's deploy on /compare's grid for that step. */
export function useEnergy(laps: LapRef[], enabled = true, step?: number) {
  const key = useSessionKey();
  const spec = laps.map((l) => `${l.driver}:${l.lap}`).join(',');
  const extra = step != null ? `&step=${step}` : '';
  return useQuery({
    queryKey: ['session', key, 'energy', spec, step ?? null],
    queryFn: () => apiGet<EnergyComparison>(`${sessionPath(key!)}/energy?laps=${spec}${extra}`),
    enabled: key != null && laps.length > 0 && enabled,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

export const useReport = (enabled = true) => useSessionQuery<SessionReport>('/report', enabled);

export const useEnergySession = (enabled = true) =>
  useSessionQuery<EnergySession>('/energy/session', enabled);

export type ProgressReference = 'previous' | 'best';

/** The lap a driver is on at session time `t` (whole seconds, so a playing clock asks about once
 * a second); the previous answer stays on screen while the next one loads. */
/** The lap `driver` is on at `t`, asked per whole second (or to the millisecond: `precise`). */
export function useLapProgress(
  driver: string | undefined,
  t: number,
  reference: ProgressReference,
  precise = false
) {
  const key = useSessionKey();
  const at = precise ? Math.round(t * 1000) / 1000 : Math.floor(t);
  return useQuery({
    queryKey: ['session', key, 'lap-progress', driver, at, reference],
    queryFn: () =>
      apiGet<LapProgress>(
        `${sessionPath(key!)}/lap-progress?driver=${driver}&t=${at}&reference=${reference}`
      ),
    enabled: key != null && driver != null,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export const useTimeline = () => useSessionQuery<SessionTimeline>('/timeline');
export const useRaceHistory = () => useSessionQuery<RaceHistory>('/race-history');

/** A strategy query at a cutoff (session time, null = everything); keeps the previous answer
 * on screen while the next lap's one loads. */
function useStrategyQuery<T>(
  resource: string,
  params: Record<string, string | number | null | undefined>,
  enabled = true
) {
  const key = useSessionKey();
  const query = Object.entries(params)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return useQuery({
    queryKey: ['session', key, resource, query],
    queryFn: () => apiGet<T>(`${sessionPath(key!)}${resource}?${query}`),
    enabled: key != null && enabled,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Cutoff in session time: null = the whole session, undefined = not known yet (no query). */
type Until = number | null | undefined;

/** Tyre degradation per stint up to the cutoff; `fuel` in s per kg. */
export const useDegradation = (until: Until, fuel: number) =>
  useStrategyQuery<Degradation>('/degradation', { until, fuel }, until !== undefined);

export const usePitWindow = (
  driver: string | null,
  until: Until,
  fuel: number,
  compound: string | null
) =>
  useStrategyQuery<PitWindow>(
    '/pit-window',
    { driver, until, fuel, compound },
    driver != null && until !== undefined
  );

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
  // Live: new laps change the tower everywhere, also inside the window of the last answer.
  const version = useLiveInfo()?.version;
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
  }, [path, version]);

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

export const positionsKey = (key: SessionKey | null) => ['session', key, 'positions'];

/** Car positions on a time grid, as typed arrays (NaN = not on track). Live, the arrays have
 * room to grow: only the first `count` points are data. */
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
    queryKey: positionsKey(key),
    queryFn: () => apiGet<ReplayPositions>(`${sessionPath(key!)}/positions`).then(toTrack),
    enabled: key != null && state === 'ready',
    staleTime: Infinity,
    // Live, the track grows in place (appendPositions); typed arrays are not compared.
    structuralSharing: false,
  });
  return { status: status.data, track: positions.data, error: status.error ?? positions.error };
}

/** New points of a live track (server-sent, see api/live.ts), from grid point `first` on. */
export type PositionsChunk = {
  first: number;
  count: number;
  cars: {
    driver: string;
    x: (number | null)[];
    y: (number | null)[];
    progress: (number | null)[];
  }[];
};

function grown(values: Float32Array, size: number): Float32Array {
  if (values.length >= size) return values;
  const next = new Float32Array(Math.max(size, Math.ceil(values.length * 1.5), 1024)).fill(NaN);
  next.set(values);
  return next;
}

/** Append a chunk to the track in place; false when points are missing in between (refetch). */
export function appendPositions(track: PositionTrack, chunk: PositionsChunk): boolean {
  if (chunk.first > track.count) return false;
  for (const car of chunk.cars) {
    let own = track.cars.find((c) => c.driver === car.driver);
    if (!own) {
      const empty = () => new Float32Array(chunk.count).fill(NaN);
      own = { driver: car.driver, x: empty(), y: empty(), progress: empty() };
      track.cars.push(own);
    }
    own.x = grown(own.x, chunk.count);
    own.y = grown(own.y, chunk.count);
    own.progress = grown(own.progress, chunk.count);
    for (let i = 0; i < car.x.length; i++) {
      const at = chunk.first + i;
      own.x[at] = car.x[i] ?? NaN;
      own.y[at] = car.y[i] ?? NaN;
      own.progress[at] = car.progress[i] ?? NaN;
    }
  }
  track.count = Math.max(track.count, chunk.count);
  return true;
}
