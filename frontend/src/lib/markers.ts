import type { Marker, SessionTimeline } from '@/api/client';
import type { LapRef } from '@/store/groups';
import { formatClock } from './replay';

/** Offered in the marker editor next to the tags already in use. */
export const SUGGESTED_TAGS = [
  'lock-up',
  'lift & coast',
  'traffic',
  'mistake',
  'track limits',
  'overtake',
  'tow',
  'pit',
];

/** A distance marker as charts, the map and the track line draw it. */
export type DistanceMark = {
  id: number;
  start: number;
  end: number | null;
  label: string;
  /** Tied to a lap that is not selected in this link group: drawn fainter. */
  dim: boolean;
  /** The marker itself, to open in the editor on a click. */
  marker: Marker;
};

export function markerLabel(marker: Pick<Marker, 'note' | 'tags'>): string {
  return [...marker.tags, marker.note].filter(Boolean).join(' · ');
}

export function markerLap(marker: Marker): string {
  if (!marker.driver) return '';
  return marker.lap == null ? marker.driver : `${marker.driver} L${marker.lap}`;
}

export function distanceMarks(markers: Marker[] | undefined, selected: LapRef[]): DistanceMark[] {
  return (markers ?? [])
    .filter((m) => m.kind === 'distance')
    .map((m) => ({
      id: m.id,
      start: m.start,
      end: m.end ?? null,
      label: markerLabel(m) || markerLap(m) || 'Marker',
      dim: m.lap != null && !selected.some((l) => l.driver === m.driver && l.lap === m.lap),
      marker: m,
    }));
}

/** Markers covering a distance; points count within `slack` metres. */
export function marksAt(marks: DistanceMark[], distance: number, slack = 15): DistanceMark[] {
  return marks.filter((m) =>
    m.end == null ? Math.abs(distance - m.start) <= slack : distance >= m.start && distance <= m.end
  );
}

/** The leader's lap (race) at session time t, from 1 (or later for a recording started late). */
export function lapAt(timeline: SessionTimeline, t: number): number {
  let started = 0;
  while (started < timeline.lap_starts.length && timeline.lap_starts[started] <= t) started++;
  return Math.max(timeline.first_lap - 1 + started, timeline.first_lap, 1);
}

/** Where a session time is: "L17 1:02:03", "Q3 54:10" or "54:10" (time since the first lap). */
export function describeTime(timeline: SessionTimeline | undefined, t: number): string {
  if (!timeline) return formatClock(t);
  const clockText = formatClock(t - timeline.start);
  if (timeline.kind === 'race') return `L${lapAt(timeline, t)} ${clockText}`;
  const segment = timeline.segments.findLast((s) => s.start <= t);
  return segment ? `${segment.name} ${clockText}` : clockText;
}

export function describeDistance(start: number, end: number | null): string {
  return end == null ? `${Math.round(start)} m` : `${Math.round(start)}–${Math.round(end)} m`;
}

export function describePlace(marker: Marker, timeline: SessionTimeline | undefined): string {
  if (marker.kind === 'distance') return describeDistance(marker.start, marker.end ?? null);
  const from = describeTime(timeline, marker.start);
  return marker.end == null ? from : `${from} → ${formatClock(marker.end - marker.start)}`;
}
