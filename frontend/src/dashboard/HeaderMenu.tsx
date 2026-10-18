import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export const headerButton =
  'flex h-6 w-6 items-center justify-center text-faint hover:bg-raised hover:text-text disabled:pointer-events-none disabled:opacity-30';

const MARGIN = 8;
/** Below this much room under the button, a 'below' menu opens above it if there is more room there. */
const MIN_ROOM = 240;

/**
 * An icon button in a panel's title bar with a dropdown under it. Closes on Escape (focus goes back
 * to the button) and on a click outside. Works inside popout windows: listeners go on the button's
 * own document. The dropdown is portalled to that document's body with a fixed position, so panels
 * below don't cover it, and scrolls when it is taller than the room left on screen.
 */
export function HeaderMenu({
  icon,
  title,
  align = 'right',
  side = 'below',
  width = 'w-64',
  buttonClassName,
  children,
}: {
  icon: ReactNode;
  title: string;
  /** Instead of the square icon button (a text button in the top bar). */
  buttonClassName?: string;
  align?: 'left' | 'right';
  /** 'above' for buttons at the bottom of the screen. */
  side?: 'below' | 'above';
  width?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [placed, setPlaced] = useState<{ style: CSSProperties; body: HTMLElement } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const button = buttonRef.current;
    if (!open || !button) {
      setPlaced(null);
      return;
    }
    const win = button.ownerDocument.defaultView ?? window;
    const place = () => {
      const rect = button.getBoundingClientRect();
      const roomBelow = win.innerHeight - rect.bottom - MARGIN;
      const roomAbove = rect.top - MARGIN;
      const above = side === 'above' || (roomBelow < MIN_ROOM && roomAbove > roomBelow);
      const style: CSSProperties = {
        ...(above
          ? { bottom: win.innerHeight - rect.top, maxHeight: roomAbove }
          : { top: rect.bottom, maxHeight: roomBelow }),
        ...(align === 'right'
          ? { right: Math.max(MARGIN, win.innerWidth - rect.right) }
          : { left: Math.max(MARGIN, rect.left) }),
      };
      setPlaced({ style, body: button.ownerDocument.body });
    };
    place();
    win.addEventListener('resize', place);
    return () => win.removeEventListener('resize', place);
  }, [open, side, align]);

  useEffect(() => {
    if (!open) return;
    const doc = buttonRef.current?.ownerDocument ?? document;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        title={title}
        aria-label={title}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(buttonClassName ?? headerButton, open && 'bg-raised text-text')}
      >
        {icon}
      </button>
      {open && placed
        ? createPortal(
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
              <div
                style={placed.style}
                className={cn(
                  'fixed z-50 overflow-y-auto overscroll-contain border border-line-strong bg-header text-[11px]',
                  width
                )}
              >
                {children(() => setOpen(false))}
              </div>
            </>,
            placed.body
          )
        : null}
    </div>
  );
}
