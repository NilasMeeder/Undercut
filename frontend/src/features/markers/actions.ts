import type { Marker } from '@/api/client';
import { clock } from '@/store/clock';
import { cursorBus } from '@/store/cursor';
import { useGroups, type GroupId } from '@/store/groups';
import { markNew } from '@/store/markerEditor';

/**
 * Show a marker: a distance marker zooms the group's charts to it (and adds the lap it is about),
 * a time marker moves the session clock there.
 */
export function jumpToMarker(marker: Marker, group: GroupId) {
  if (marker.kind === 'time') {
    clock.pause();
    clock.seek(marker.start);
    return;
  }
  if (marker.driver && marker.lap != null) {
    const lap = { driver: marker.driver, lap: marker.lap };
    const selected = useGroups.getState().laps[group];
    if (!selected.some((l) => l.driver === lap.driver && l.lap === lap.lap))
      useGroups.getState().toggleLap(group, lap);
  }
  const end = marker.end ?? marker.start;
  const pad = Math.max(150, (end - marker.start) * 0.5);
  cursorBus.setZoom(group, [Math.max(0, marker.start - pad), end + pad]);
  if (marker.end == null) cursorBus.setCursor(group, marker.start);
}

/** Mark where the group is looking: its zoomed range, else the cursor, else ask for a distance. */
export function markDistance(group: GroupId) {
  const zoom = cursorBus.getZoom(group);
  const cursor = cursorBus.getCursor(group);
  if (zoom)
    markNew({ kind: 'distance', start: Math.round(zoom[0]), end: Math.round(zoom[1]), group });
  else markNew({ kind: 'distance', start: cursor == null ? null : Math.round(cursor), group });
}

export function markMoment() {
  markNew({ kind: 'time', start: clock.time() });
}
