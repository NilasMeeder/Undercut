import { useState } from 'react';
import { Check, Link2 } from 'lucide-react';
import { headerButton } from '@/dashboard/HeaderMenu';
import { cn } from '@/lib/utils';
import { useSessionKey } from '@/store/selection';
import { copyShareLink } from './share';

/** Copies a link to this dashboard as it is now (session, laps, zoom, clock, layout). */
export function ShareButton() {
  const session = useSessionKey();
  const [copied, setCopied] = useState(false);
  if (!session) return null;
  return (
    <button
      type="button"
      title={
        copied
          ? 'Link copied'
          : 'Copy a link to this dashboard: session, laps, zoom, clock and layout'
      }
      aria-label="Copy a link to this dashboard"
      onClick={async () => {
        await copyShareLink(session);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={cn(headerButton, copied && 'text-text')}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
    </button>
  );
}
