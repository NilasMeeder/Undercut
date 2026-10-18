import { useSyncExternalStore } from 'react';
import { ExternalLink, Maximize2, Minimize2 } from 'lucide-react';
import { headerButton } from '@/dashboard/HeaderMenu';
import { cn } from '@/lib/utils';
import { useDashboards, WORKSPACES, type Workspace } from '@/store/dashboards';

/** ANALYSIS | PITWALL at the left of the top bar (w), and the other one in a new window. */
export function WorkspaceSwitch() {
  const workspace = useDashboards((s) => s.workspace);
  const setWorkspace = useDashboards((s) => s.setWorkspace);
  const other = WORKSPACES.find((w) => w.id !== workspace)!;
  return (
    <div className="flex items-center" role="tablist" aria-label="Workspace">
      {WORKSPACES.map((w) => (
        <button
          key={w.id}
          type="button"
          role="tab"
          aria-selected={w.id === workspace}
          onClick={() => setWorkspace(w.id)}
          title={
            w.id === 'analysis'
              ? 'Analysis: compare laps after the session, the clock at the end (w)'
              : 'Pitwall: a board that plays with the clock, live or watching back (w)'
          }
          className={cn(
            'h-6 border border-l-0 border-line-strong px-2 text-[10px] font-semibold tracking-[0.12em] first:border-l',
            w.id === workspace ? 'bg-raised text-text' : 'text-faint hover:text-text'
          )}
        >
          {w.title.toUpperCase()}
        </button>
      ))}
      <button
        type="button"
        title={`Open ${other.title} in a new window (for a second screen)`}
        aria-label={`Open ${other.title} in a new window`}
        onClick={() => openWorkspaceWindow(other.id)}
        className={headerButton}
      >
        <ExternalLink className="h-3 w-3" />
      </button>
    </div>
  );
}

function openWorkspaceWindow(workspace: Workspace) {
  const url = new URL(window.location.href);
  url.searchParams.set('ws', workspace);
  url.hash = '';
  window.open(url, `f1dash-${workspace}`, 'popup,width=1600,height=1000');
}

function subscribeFullscreen(fn: () => void) {
  document.addEventListener('fullscreenchange', fn);
  return () => document.removeEventListener('fullscreenchange', fn);
}

/** Pitwall: unlock the panels to change the board, and full screen. */
export function PitwallControls() {
  const editing = useDashboards((s) => s.editing);
  const setEditing = useDashboards((s) => s.setEditing);
  const fullscreen = useSyncExternalStore(subscribeFullscreen, () => !!document.fullscreenElement);
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-pressed={editing}
        onClick={() => setEditing(!editing)}
        title={
          editing
            ? 'Lock the board again'
            : 'Unlock the board: move and resize panels, add panels, settings and presets'
        }
        className={cn(
          'h-5 border px-1.5 text-[10px] font-semibold tracking-wider',
          editing
            ? 'border-line-strong bg-raised text-text'
            : 'border-transparent text-faint hover:text-text'
        )}
      >
        EDIT
      </button>
      <button
        type="button"
        title={fullscreen ? 'Leave full screen' : 'Full screen'}
        aria-label={fullscreen ? 'Leave full screen' : 'Full screen'}
        onClick={() =>
          void (fullscreen
            ? document.exitFullscreen()
            : document.documentElement.requestFullscreen())
        }
        className={headerButton}
      >
        {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
