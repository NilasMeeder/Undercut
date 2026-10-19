import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type RadioAutoplay = 'off' | 'group' | 'all';

/** Team radio: one clip plays at a time, app-wide; and whether clips play by themselves when the
 * session clock passes them. */
type RadioState = {
  /** The clip playing (its id in the session's list), or null. */
  playing: number | null;
  autoplay: RadioAutoplay;
  play: (clip: number, url: string) => void;
  stop: () => void;
  setAutoplay: (autoplay: RadioAutoplay) => void;
};

let audio: HTMLAudioElement | null = null;

export const useRadio = create<RadioState>()(
  persist(
    (set) => ({
      playing: null,
      autoplay: 'group',
      play: (clip, url) => {
        audio?.pause();
        const next = new Audio(url);
        audio = next;
        set({ playing: clip });
        const done = () => {
          if (audio === next) set({ playing: null });
        };
        next.addEventListener('ended', done);
        next.addEventListener('error', done);
        // The browser may refuse to play before the page had a click: then nothing plays.
        next.play().catch(done);
      },
      stop: () => {
        audio?.pause();
        audio = null;
        set({ playing: null });
      },
      setAutoplay: (autoplay) => set({ autoplay }),
    }),
    { name: 'f1dash-radio', partialize: (s) => ({ autoplay: s.autoplay }) }
  )
);
