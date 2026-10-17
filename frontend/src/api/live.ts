import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clock } from '@/store/clock';
import { setLiveInfo } from '@/store/live';
import { sessionPath, useSessionKey, type SessionKey } from '@/store/selection';
import { apiGet, type LiveSessionInfo } from './client';
import {
  appendPositions,
  positionsKey,
  useTimeline,
  type PositionTrack,
  type PositionsChunk,
} from './queries';

/** Recorded sessions (live ones first); checked now and then for a session that starts. */
export function useLiveSessions() {
  return useQuery({
    queryKey: ['live'],
    queryFn: () => apiGet<LiveSessionInfo[]>('/live'),
    refetchInterval: 15_000,
  });
}

const sameSession = (info: LiveSessionInfo, key: SessionKey) =>
  info.year === key.year && info.round === key.round && info.code === key.session;

/** Seconds the clock's live edge stays behind the newest data: positions come in a moment later
 * than timing (the track waits for the samples around a point, and then for the next event). */
const EDGE_MARGIN = 2;

/** Query resources that do not change with new laps. */
const STABLE = new Set(['markers', 'positions', 'positions-status', '/circuit']);

/**
 * Follows the selected session while it is live: server-sent events with the data horizon and
 * version. The horizon moves the clock's live edge; a new version refetches the session's data.
 * A session that turns live while selected starts following.
 */
export function useLiveSession() {
  const key = useSessionKey();
  const sessions = useLiveSessions();
  const client = useQueryClient();
  const info = key ? sessions.data?.find((s) => sameSession(s, key)) : undefined;
  const live = info?.state === 'live';
  const path = key ? sessionPath(key) : null;
  const version = useRef<number | null>(null);
  // The clock loads a session once its timeline is there; following before that would be undone.
  const timeline = useTimeline();
  const ready = useRef(false);
  const keyRef = useRef(key);
  useEffect(() => {
    ready.current = timeline.data != null;
    keyRef.current = key;
  });

  useEffect(() => {
    const key = keyRef.current;
    if (!live || !path || !key) return;
    let follow = true;
    const source = new EventSource(`/api/live${path.slice('/sessions'.length)}/events`);
    source.addEventListener('status', (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as LiveSessionInfo;
      if (version.current != null && next.version !== version.current) {
        void client.invalidateQueries({
          queryKey: ['session', key],
          predicate: (q) => !STABLE.has(String(q.queryKey[2])),
        });
      }
      version.current = next.version;
      setLiveInfo(next);
      const edge = next.horizon == null ? null : next.horizon - EDGE_MARGIN;
      clock.setLiveEdge(next.state === 'live' ? edge : null);
      if (follow && ready.current && next.state === 'live' && next.horizon != null) {
        follow = false;
        clock.goLive();
      }
    });
    source.addEventListener('positions', (event) => {
      const chunk = JSON.parse((event as MessageEvent<string>).data) as PositionsChunk;
      const track = client.getQueryData<PositionTrack>(positionsKey(key));
      // Not loaded yet: the fetch brings these points too.
      if (track && !appendPositions(track, chunk)) {
        void client.invalidateQueries({ queryKey: positionsKey(key) });
      }
    });
    return () => {
      source.close();
      version.current = null;
      setLiveInfo(null);
      clock.setLiveEdge(null);
    };
  }, [live, path, client]);
}
