import { useEffect, useState, type RefObject } from 'react';
import { clock } from '@/store/clock';

/** Run `draw` with the clock time now and on every tick (every frame while playing). */
export function useClockDraw(draw: ((t: number) => void) | null) {
  useEffect(() => {
    if (!draw) return;
    const update = () => draw(clock.time());
    update();
    return clock.subscribe(update);
  }, [draw]);
}

/** An element's size in CSS pixels, updated on resize. */
export function useElementSize(ref: RefObject<Element | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
