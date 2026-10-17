import { useCallback, useEffect, useRef, useState } from 'react';
import type { View } from '@/api/client';
import { useSaveView, useViews } from '@/api/views';
import { useDashboards } from '@/store/dashboards';
import { useSessionKey } from '@/store/selection';
import { currentView, openView, viewIdFromHash } from './views';

const linkActive = (view: View) =>
  useDashboards.getState().linkView(useDashboards.getState().active, view.id);

/** Saving the current view: the commands and the menu share it. */
export function useSaveCurrentView() {
  const session = useSessionKey();
  const save = useSaveView();
  const { mutateAsync } = save;
  const saveView = useCallback(
    async (name: string, id?: number) => {
      if (!session) return;
      const view = await mutateAsync({ id, view: currentView(name, session) });
      linkActive(view);
      return view;
    },
    [session, mutateAsync]
  );
  return { pending: save.isPending, error: save.error, save: saveView };
}

/** Opens the view in the URL (#view=12) at startup or when the hash changes, then clears it. */
export function useViewFromUrl() {
  const views = useViews();
  // A new object per request, so pasting the same link again opens the view again.
  const [wanted, setWanted] = useState(() => ({ id: viewIdFromHash() }));
  const handled = useRef<object | null>(null);
  useEffect(() => {
    const onHash = () => setWanted({ id: viewIdFromHash() });
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (wanted.id == null || !views.data || handled.current === wanted) return;
    handled.current = wanted;
    const view = views.data.find((v) => v.id === wanted.id);
    if (view) openView(view);
    history.replaceState(null, '', location.pathname + location.search);
  }, [wanted, views.data]);
}
