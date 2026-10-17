import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { distanceMarks, type DistanceMark } from '@/lib/markers';
import { useGroupLaps, type GroupId } from '@/store/groups';
import { sessionPath, useSessionKey, type SessionKey } from '@/store/selection';
import { apiGet, apiSend, type Marker, type MarkerIn, type TagCount } from './client';

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

/** The session's distance markers as a link group draws them. */
export function useDistanceMarks(group: GroupId): DistanceMark[] {
  const markers = useMarkers();
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
