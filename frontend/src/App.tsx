import { useLiveSession } from '@/api/live';
import { Dashboard } from '@/dashboard/Dashboard';
import { ClockBar } from '@/features/clock/ClockBar';
import { useSessionClock } from '@/features/clock/useSessionClock';
import { CommandPalette } from '@/features/commands/CommandPalette';
import { DashboardTabs, LayoutMenu } from '@/features/dashboards/DashboardTabs';
import { ArchiveMenu } from '@/features/live/ArchiveMenu';
import { LiveBadge } from '@/features/live/LiveBadge';
import { RecorderMenu } from '@/features/live/RecorderMenu';
import { MarkerEditor } from '@/features/markers/MarkerEditor';
import { useShareFromUrl, useViewFromUrl } from '@/features/views/hooks';
import { ShareButton } from '@/features/views/ShareButton';
import { ViewsMenu } from '@/features/views/ViewsMenu';
import { AlertToasts, AlertsMenu } from '@/features/alerts/Alerts';
import { FollowLatest } from '@/features/session/FollowLatest';
import { RadioAutoplay } from '@/features/radio/RadioAutoplay';
import { GroupBar } from '@/features/session/GroupBar';
import { SessionPicker } from '@/features/session/SessionPicker';
import { useDefaultSelection } from '@/features/session/useDefaultSelection';
import { useSessionKey } from '@/store/selection';
import { useDashboards } from '@/store/dashboards';
import { PitwallControls, WorkspaceSwitch } from '@/features/workspace/Workspace';
import { useWorkspaceClock } from '@/features/workspace/useWorkspaceClock';

export default function App() {
  const session = useSessionKey();
  useDefaultSelection();
  useSessionClock();
  useLiveSession();
  useViewFromUrl();
  useShareFromUrl();
  useWorkspaceClock();
  const pitwall = useDashboards((s) => s.workspace === 'pitwall');
  const editing = useDashboards((s) => s.editing);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-8 shrink-0 items-center gap-3 border-b border-line bg-header px-2">
        <WorkspaceSwitch />
        <SessionPicker />
        <GroupBar />
        <LiveBadge />
        {session ? <ArchiveMenu /> : null}
        <div className="ml-auto" />
        <RecorderMenu />
        {session ? <CommandPalette /> : null}
        {session ? <DashboardTabs /> : null}
        {session ? <ShareButton /> : null}
        {session && !pitwall ? <ViewsMenu /> : null}
        {session && (!pitwall || editing) ? <LayoutMenu /> : null}
        {session && pitwall ? <AlertsMenu /> : null}
        {session && pitwall ? <PitwallControls /> : null}
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
      {session ? <RadioAutoplay /> : null}
      {session && pitwall ? <AlertToasts /> : null}
    </div>
  );
}
