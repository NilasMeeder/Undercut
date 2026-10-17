import { useSyncExternalStore } from 'react';
import type { LiveSessionInfo } from '@/api/client';

// The live state of the selected session, outside React like the clock: what needs the data
// version (the timing tower) subscribes to it. Set by useLiveSession (api/live.ts).
let current: LiveSessionInfo | null = null;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export function setLiveInfo(info: LiveSessionInfo | null) {
  current = info;
  listeners.forEach((fn) => fn());
}

/** The selected session's live state, or null when it is not a live recording. */
export const useLiveInfo = () => useSyncExternalStore(subscribe, () => current);
