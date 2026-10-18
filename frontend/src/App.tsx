import { useLiveSession } from '@/api/live';
import { Dashboard } from '@/dashboard/Dashboard';
import { ClockBar } from '@/features/clock/ClockBar';
import { useSessionClock } from '@/features/clock/useSessionClock';
import { CommandPalette } from '@/features/commands/CommandPalette';
import { DashboardTabs, LayoutMenu } from '@/features/dashboards/DashboardTabs';
import { LiveBadge } from '@/features/live/LiveBadge';
import { MarkerEditor } from '@/features/markers/MarkerEditor';
import { useViewFromUrl } from '@/features/views/hooks';
import { ViewsMenu } from '@/features/views/ViewsMenu';
import { FollowLatest } from '@/features/session/FollowLatest';
import { GroupBar } from '@/features/session/GroupBar';
import { SessionPicker } from '@/features/session/SessionPicker';
import { useDefaultSelection } from '@/features/session/useDefaultSelection';
import { useSessionKey } from '@/store/selection';

export default function App() {
  const session = useSessionKey();
  useDefaultSelection();
  useSessionClock();
  useLiveSession();
  useViewFromUrl();

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-8 shrink-0 items-center gap-3 border-b border-line bg-header px-2">
        <span className="text-[11px] font-semibold tracking-[0.15em] text-dim">PITWALL</span>
        <SessionPicker />
        <GroupBar />
        <LiveBadge />
        <div className="ml-auto" />
        {session ? <CommandPalette /> : null}
        {session ? <DashboardTabs /> : null}
        {session ? <ViewsMenu /> : null}
        {session ? <LayoutMenu /> : null}
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
      {session ? <ClockBar /> : null}
      {session ? <MarkerEditor /> : null}
      {session ? <FollowLatest /> : null}
    </div>
  );
}
