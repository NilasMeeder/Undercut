import { useState } from 'react';
import { Bookmark, Link, RefreshCw, X } from 'lucide-react';
import type { View } from '@/api/client';
import { useDeleteView, useViews } from '@/api/views';
import { useActiveLinkGroup } from '@/dashboard/api';
import { HeaderMenu, headerButton } from '@/dashboard/HeaderMenu';
import { cn } from '@/lib/utils';
import { useDashboards } from '@/store/dashboards';
import { useSessionKey, type SessionKey } from '@/store/selection';
import { useSaveCurrentView } from './hooks';
import { openView, sessionLabel, suggestName, viewLink } from './views';

function sameSession(view: View, session: SessionKey | null) {
  return (
    session != null &&
    view.year === session.year &&
    view.round === session.round &&
    view.session === session.session
  );
}

/** The bookmark menu in the top bar: save the current view, open, update, link or delete one. */
export function ViewsMenu() {
  const views = useViews();
  const session = useSessionKey();
  const group = useActiveLinkGroup();
  const linked = useDashboards((s) => s.tabs.find((t) => t.id === s.active)?.viewId);
  const { save, pending, error } = useSaveCurrentView();
  const remove = useDeleteView();
  const [name, setName] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);

  const flash = (message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 3000);
  };
  const all = views.data ?? [];
  const here = all.filter((v) => sameSession(v, session));
  const elsewhere = all.filter((v) => !sameSession(v, session));

  const row = (view: View, close: () => void, current: boolean) => (
    <div key={view.id} className="group flex items-center hover:bg-raised">
      <button
        type="button"
        onClick={() => {
          close();
          openView(view);
        }}
        title={`Open: ${sessionLabel(view)}, saved ${new Date(view.updated).toLocaleString()}`}
        className="flex min-w-0 flex-1 items-baseline gap-1.5 px-2 py-1 text-left"
      >
        <span className={cn('truncate', view.id === linked ? 'text-text' : 'text-dim')}>
          {view.name}
        </span>
        {current ? null : (
          <span className="shrink-0 text-[10px] text-faint">{sessionLabel(view)}</span>
        )}
      </button>
      {current ? (
        <button
          type="button"
          title="Update with what is on screen now"
          aria-label={`Update ${view.name}`}
          onClick={async () => {
            await save(view.name, view.id);
            flash(`Updated “${view.name}”`);
          }}
          className={cn(headerButton, 'h-5 w-5 opacity-0 group-hover:opacity-100')}
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      ) : null}
      <button
        type="button"
        title="Copy a link that opens this view"
        aria-label={`Copy link to ${view.name}`}
        onClick={async () => {
          await navigator.clipboard?.writeText(viewLink(view)).catch(() => undefined);
          flash(viewLink(view));
        }}
        className={cn(headerButton, 'h-5 w-5 opacity-0 group-hover:opacity-100')}
      >
        <Link className="h-3 w-3" />
      </button>
      <button
        type="button"
        title={confirm === view.id ? 'Click again to delete' : 'Delete'}
        aria-label={`Delete ${view.name}`}
        onClick={() => {
          if (confirm !== view.id) return setConfirm(view.id);
          setConfirm(null);
          remove.mutate(view.id);
        }}
        className={cn(
          headerButton,
          'h-5 w-5',
          confirm === view.id ? 'text-pit' : 'opacity-0 group-hover:opacity-100'
        )}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );

  return (
    <HeaderMenu icon={<Bookmark className="h-3.5 w-3.5" />} title="Saved views" width="w-80">
      {(close) => (
        <div className="py-0.5">
          <form
            className="flex items-center gap-1 px-2 py-1"
            onSubmit={async (e) => {
              e.preventDefault();
              const view = await save(name.trim() || suggestName(group));
              setName('');
              if (view) flash(`Saved “${view.name}”`);
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={suggestName(group)}
              aria-label="Name of the view"
              maxLength={80}
              className="h-6 min-w-0 flex-1 border border-line-strong bg-panel px-1.5 text-text outline-none placeholder:text-faint focus:border-dim"
            />
            <button
              type="submit"
              disabled={pending || !session}
              className="h-6 border border-dim bg-raised px-2 text-text disabled:opacity-40"
            >
              Save view
            </button>
          </form>
          <div className="px-2 pb-1 text-[10px] text-faint">
            Session, laps, zoom, clock and this dashboard’s layout.
          </div>
          {status || error ? (
            <div className={cn('truncate px-2 pb-1', error ? 'text-pit' : 'text-dim')}>
              {error ? error.message : status}
            </div>
          ) : null}
          {here.length > 0 ? (
            <>
              <div className="border-t border-line px-2 pb-0.5 pt-1 text-[10px] uppercase text-faint">
                This session
              </div>
              {here.map((v) => row(v, close, true))}
            </>
          ) : null}
          {elsewhere.length > 0 ? (
            <>
              <div className="border-t border-line px-2 pb-0.5 pt-1 text-[10px] uppercase text-faint">
                Other sessions
              </div>
              {elsewhere.map((v) => row(v, close, false))}
            </>
          ) : null}
          {all.length === 0 && views.data ? (
            <div className="border-t border-line px-2 py-1 text-faint">No saved views yet.</div>
          ) : null}
        </div>
      )}
    </HeaderMenu>
  );
}
