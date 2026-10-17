import { LayoutGrid } from 'lucide-react';
import { applyQualiDuel } from '@/dashboard/layout';
import { useDashboardApi } from '@/dashboard/api';
import { Dashboard } from '@/dashboard/Dashboard';
import { GroupBar } from '@/features/session/GroupBar';
import { SessionPicker } from '@/features/session/SessionPicker';
import { useDefaultSelection } from '@/features/session/useDefaultSelection';
import { useSessionKey } from '@/store/selection';

export default function App() {
  const session = useSessionKey();
  const api = useDashboardApi((s) => s.api);
  useDefaultSelection();

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-8 shrink-0 items-center gap-3 border-b border-line bg-header px-2">
        <span className="text-[11px] font-semibold tracking-[0.15em] text-dim">PITWALL</span>
        <SessionPicker />
        <GroupBar />
        <button
          type="button"
          title="Reset to the Quali duel layout"
          disabled={!api}
          onClick={() => api && applyQualiDuel(api)}
          className="ml-auto flex h-6 items-center gap-1 px-1.5 text-[11px] text-faint hover:bg-raised hover:text-text"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Quali duel
        </button>
      </header>
      <main className="min-h-0 flex-1">
        {session ? (
          <Dashboard />
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-faint">
            Pick a season, event and session in the top bar.
          </div>
        )}
      </main>
    </div>
  );
}
