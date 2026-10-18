import { useSyncExternalStore } from 'react';
import type { GroupId } from './groups';

/**
 * Cursor (distance in metres) and zoom (distance range) per link group.
 *
 * Deliberately outside React state: the cursor moves at mouse rate, and charts/maps update
 * imperatively via subscribe(). Components that only need to re-render occasionally (zoom,
 * value readouts) can use the hooks below.
 */
export type Range = [number, number];
/** Where a zoom came from, when that matters: `energy` = a straight clicked in Energy (the map
 * then shows where the lap deployed and clipped). */
export type ZoomKind = 'energy';
type Listener = (source: string | undefined) => void;

const cursors = new Map<GroupId, number | null>();
const frozen = new Set<GroupId>();
const zooms = new Map<GroupId, Range | null>();
const zoomKinds = new Map<GroupId, ZoomKind | null>();
const cursorListeners = new Map<GroupId, Set<Listener>>();
const zoomListeners = new Map<GroupId, Set<Listener>>();

function listenersFor(map: Map<GroupId, Set<Listener>>, group: GroupId): Set<Listener> {
  let set = map.get(group);
  if (!set) {
    set = new Set();
    map.set(group, set);
  }
  return set;
}

export const cursorBus = {
  getCursor: (group: GroupId) => cursors.get(group) ?? null,
  setCursor(group: GroupId, distance: number | null, source?: string) {
    if (frozen.has(group) || cursors.get(group) === distance) return;
    cursors.set(group, distance);
    listenersFor(cursorListeners, group).forEach((fn) => fn(source));
  },
  subscribeCursor(group: GroupId, fn: Listener) {
    const set = listenersFor(cursorListeners, group);
    set.add(fn);
    return () => void set.delete(fn);
  },

  /** A frozen cursor ignores hovering until it is unfrozen (keyboard: f). */
  isFrozen: (group: GroupId) => frozen.has(group),
  toggleFrozen(group: GroupId) {
    if (frozen.has(group)) frozen.delete(group);
    else if (cursors.get(group) != null) frozen.add(group);
    // Listeners re-read the cursor; charts that were hovered snap back to the frozen position.
    listenersFor(cursorListeners, group).forEach((fn) => fn(undefined));
  },

  getZoom: (group: GroupId) => zooms.get(group) ?? null,
  getZoomKind: (group: GroupId) => zoomKinds.get(group) ?? null,
  setZoom(group: GroupId, range: Range | null, source?: string, kind: ZoomKind | null = null) {
    zooms.set(group, range);
    zoomKinds.set(group, range ? kind : null);
    listenersFor(zoomListeners, group).forEach((fn) => fn(source));
  },
  subscribeZoom(group: GroupId, fn: Listener) {
    const set = listenersFor(zoomListeners, group);
    set.add(fn);
    return () => void set.delete(fn);
  },
};

export function useCursor(group: GroupId): number | null {
  return useSyncExternalStore(
    (fn) => cursorBus.subscribeCursor(group, fn),
    () => cursorBus.getCursor(group)
  );
}

export function useFrozen(group: GroupId): boolean {
  return useSyncExternalStore(
    (fn) => cursorBus.subscribeCursor(group, fn),
    () => cursorBus.isFrozen(group)
  );
}

export function useZoom(group: GroupId): Range | null {
  return useSyncExternalStore(
    (fn) => cursorBus.subscribeZoom(group, fn),
    () => cursorBus.getZoom(group)
  );
}

export function useZoomKind(group: GroupId): ZoomKind | null {
  return useSyncExternalStore(
    (fn) => cursorBus.subscribeZoom(group, fn),
    () => cursorBus.getZoomKind(group)
  );
}
