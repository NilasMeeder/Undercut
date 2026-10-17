import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const headerButton =
  'flex h-6 w-6 items-center justify-center text-faint hover:bg-raised hover:text-text disabled:pointer-events-none disabled:opacity-30';

/**
 * An icon button in a panel's title bar with a dropdown under it. Closes on Escape (focus goes back
 * to the button) and on a click outside. Works inside popout windows: listeners go on the button's
 * own document.
 */
export function HeaderMenu({
  icon,
  title,
  align = 'right',
  side = 'below',
  width = 'w-64',
  children,
}: {
  icon: ReactNode;
  title: string;
  align?: 'left' | 'right';
  /** 'above' for buttons at the bottom of the screen. */
  side?: 'below' | 'above';
  width?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

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
        className={cn(headerButton, open && 'bg-raised text-text')}
      >
        {icon}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={cn(
              'absolute z-50 border border-line-strong bg-header text-[11px]',
              side === 'below' ? 'top-6' : 'bottom-6',
              width,
              align === 'right' ? 'right-0' : 'left-0'
            )}
          >
            {children(() => setOpen(false))}
          </div>
        </>
      ) : null}
    </div>
  );
}
