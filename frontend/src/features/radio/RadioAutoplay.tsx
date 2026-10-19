import { useEffect, useMemo, useRef } from 'react';
import { radioUrl, type TeamRadio } from '@/api/client';
import { useTeamRadio } from '@/api/queries';
import { useClockPassing } from '@/features/clock/useClockPassing';
import { useGroups } from '@/store/groups';
import { useRadio } from '@/store/radio';
import { sessionPath, useSessionKey } from '@/store/selection';

/** Seconds a clip may wait in the queue behind another one; older ones are dropped. */
const STALE = 45;

/**
 * Plays team radio by itself as the session clock passes it (playing, or live), for the
 * drivers in the link groups or every car; one after the other. Renders nothing.
 */
export function RadioAutoplay() {
  const key = useSessionKey();
  const autoplay = useRadio((s) => s.autoplay);
  const playing = useRadio((s) => s.playing);
  const clips = useTeamRadio(autoplay !== 'off').data;
  const groupLaps = useGroups((s) => s.laps);
  const items = useMemo(() => {
    if (autoplay === 'off' || !clips) return [];
    const watched = new Set(Object.values(groupLaps).flatMap((l) => l.map((x) => x.driver)));
    return clips
      .filter((c) => c.t != null && (autoplay === 'all' || watched.has(c.driver)))
      .map((clip) => ({ key: String(clip.id), time: clip.t!, clip }));
  }, [autoplay, clips, groupLaps]);
  const queue = useRef<TeamRadio[]>([]);
  const path = key ? sessionPath(key) : null;

  const next = () => {
    const radio = useRadio.getState();
    if (radio.playing != null || !path) return;
    const newest = queue.current.at(-1)?.t ?? 0;
    queue.current = queue.current.filter((c) => newest - c.t! < STALE);
    const clip = queue.current.shift();
    if (clip) radio.play(clip.id, radioUrl(path, clip.id));
  };

  useClockPassing(
    items,
    `${path}/${autoplay}`,
    (fresh) => {
      queue.current.push(...fresh.map((f) => f.clip));
      next();
    },
    () => {
      queue.current = [];
    }
  );
  // The next one when a clip ends.
  useEffect(() => {
    if (playing == null) next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);
  // Another session: stop what plays.
  useEffect(() => () => useRadio.getState().stop(), [path]);
  return null;
}
