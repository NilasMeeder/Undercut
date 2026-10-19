import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { autoMarkers } from '@/lib/autoMarkers';
import { distanceMarks, type DistanceMark } from '@/lib/markers';
import { useAutoMarkersOn } from '@/store/autoMarkers';
import { useGroupLaps, type GroupId } from '@/store/groups';
import { useLiveInfo } from '@/store/live';
import { sessionPath, useSessionKey, type SessionKey } from '@/store/selection';
import { apiGet, apiSend, type Marker, type MarkerIn, type TagCount } from './client';
import { useReport } from './queries';

const markersKey = (key: SessionKey | null) => ['session', key, 'markers'];
const TAGS_KEY = ['markers', 'tags'];

/** Markers of the selected session (user data: refetched after every change, not cached forever). */
export function useMarkers() {
  const key = useSessionKey();
  return useQuery({
    queryKey: markersKey(key),
    queryFn: () => apiGet<Marker[]>(`${sessionPath(key!)}/markers`),
    enabled: key != null,
  });
}

/**
 * The stored markers plus the automatic ones (the session report's findings, `lib/autoMarkers`)
 * when they are on. Not while a session is live: the report would be worked out again on every
 * update of the feed. `data` is undefined until the stored markers are in.
 */
export function useAllMarkers() {
  const markers = useMarkers();
  const key = useSessionKey();
  const on = useAutoMarkersOn((s) => s.on);
  const live = useLiveInfo()?.state === 'live';
  const report = useReport(on && !live && key != null);
  const auto = on && !live ? report.data : undefined;
  const data = useMemo(
    () =>
      markers.data && auto && key ? [...markers.data, ...autoMarkers(auto, key)] : markers.data,
    [markers.data, auto, key]
  );
  return { data, error: markers.error };
}

/** The session's distance markers as a link group draws them. */
export function useDistanceMarks(group: GroupId): DistanceMark[] {
  const markers = useAllMarkers();
  const selected = useGroupLaps(group);
  return useMemo(() => distanceMarks(markers.data, selected), [markers.data, selected]);
}

/** Tags in use over all sessions, most used first. */
export function useMarkerTags() {
  return useQuery({ queryKey: TAGS_KEY, queryFn: () => apiGet<TagCount[]>('/markers/tags') });
}

export function useSaveMarker() {
  const key = useSessionKey();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, marker }: { id?: number; marker: MarkerIn }) =>
      id == null
        ? apiSend<Marker>('POST', `${sessionPath(key!)}/markers`, marker)
        : apiSend<Marker>('PUT', `/markers/${id}`, marker),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: markersKey(key) });
      void client.invalidateQueries({ queryKey: TAGS_KEY });
    },
  });
}

export function useDeleteMarker() {
  const key = useSessionKey();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiSend<void>('DELETE', `/markers/${id}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: markersKey(key) });
      void client.invalidateQueries({ queryKey: TAGS_KEY });
    },
  });
}
