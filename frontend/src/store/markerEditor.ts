import { create } from 'zustand';
import type { Marker, MarkerKind } from '@/api/client';
import type { GroupId } from './groups';

/** A marker being made or edited. `start` null: a distance still to be typed in. */
export type MarkerDraft = {
  id?: number;
  kind: MarkerKind;
  start: number | null;
  end: number | null;
  driver: string | null;
  lap: number | null;
  note: string;
  tags: string[];
  /** Link group it was made from: its laps are offered to attach the marker to. */
  group?: GroupId;
};

type EditorState = {
  draft: MarkerDraft | null;
  /** Counts opens, so the editor starts fresh for every draft. */
  seq: number;
  close: () => void;
};

export const useMarkerEditor = create<EditorState>()((set) => ({
  draft: null,
  seq: 0,
  close: () => set({ draft: null }),
}));

const open = (draft: MarkerDraft) => useMarkerEditor.setState((s) => ({ draft, seq: s.seq + 1 }));

/** Open the marker editor (one at a time, in the main window) for a new marker. */
export function markNew(draft: Pick<MarkerDraft, 'kind' | 'start'> & Partial<MarkerDraft>) {
  open({ end: null, driver: null, lap: null, note: '', tags: [], ...draft });
}

export function editMarker(marker: Marker, group?: GroupId) {
  const { id, kind, start, end, driver, lap, note, tags } = marker;
  open({
    id,
    kind,
    start,
    end: end ?? null,
    driver: driver ?? null,
    lap: lap ?? null,
    note,
    tags,
    group,
  });
}
