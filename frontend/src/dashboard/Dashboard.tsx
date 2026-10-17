import { useCallback, useState } from 'react';
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from 'dockview-react';
import { ExternalLink, Plus, X } from 'lucide-react';
import { GROUP_COLORS, nextGroup, type GroupId } from '@/store/groups';
import { WIDGETS } from '@/widgets/registry';
import { addWidget, applyQualiDuel, restoreLayout, saveLayout, type PanelParams } from './layout';
import { useDashboardApi } from './api';

const theme: DockviewTheme = {
  name: 'pitwall',
  className: 'dockview-theme-pitwall',
  colorScheme: 'dark',
  gap: 1,
};

const components = Object.fromEntries(
  WIDGETS.map((widget) => {
    const Widget = widget.component;
    const Panel = ({ params }: IDockviewPanelProps<PanelParams>) => (
      <Widget group={params.group ?? 'blue'} />
    );
    Panel.displayName = `Panel(${widget.id})`;
    return [widget.id, Panel];
  })
);

/** Tab: link-group square (click to cycle groups), title, close. */
function PanelTab({ api, params }: IDockviewPanelHeaderProps<PanelParams>) {
  const group: GroupId = params.group ?? 'blue';
  return (
    <div className="flex h-full items-center gap-1.5 pl-1.5 pr-1 text-[11px]">
      <button
        type="button"
        title={`Link group: ${group}. Click to change.`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          api.updateParameters({ group: nextGroup(group) });
        }}
        className="h-2.5 w-2.5 shrink-0"
        style={{ background: GROUP_COLORS[group] }}
      />
      <span className="truncate">{api.title}</span>
      <button
        type="button"
        title="Close panel"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          api.close();
        }}
        className="ml-0.5 text-faint hover:text-text"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function AddWidgetMenu({
  onPick,
  align = 'right',
}: {
  onPick: (widget: string) => void;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        title="Add panel"
        onClick={() => setOpen((o) => !o)}
        className="flex h-6 w-6 items-center justify-center text-faint hover:bg-raised hover:text-text"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`absolute top-6 z-50 w-64 border border-line-strong bg-header py-0.5 ${align === 'right' ? 'right-0' : 'left-0'}`}
          >
            {WIDGETS.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onPick(w.id);
                }}
                className="block w-full px-2 py-1 text-left hover:bg-raised"
              >
                <div className="text-[11px] text-text">{w.title}</div>
                <div className="text-[10px] text-faint">{w.description}</div>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function GroupActions({ containerApi, group, activePanel }: IDockviewHeaderActionsProps) {
  const linkGroup = (activePanel?.params as PanelParams | undefined)?.group ?? 'blue';
  return (
    <div className="flex h-full items-center">
      <AddWidgetMenu
        onPick={(widget) => addWidget(containerApi, widget, linkGroup, { referenceGroup: group })}
      />
      <button
        type="button"
        title="Open in a separate window"
        onClick={() => void containerApi.addPopoutGroup(group)}
        className="flex h-6 w-6 items-center justify-center text-faint hover:bg-raised hover:text-text"
      >
        <ExternalLink className="h-3 w-3" />
      </button>
    </div>
  );
}

function EmptyDashboard({ containerApi }: { containerApi: DockviewApi }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-[11px] text-faint">
      <p>No panels.</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => applyQualiDuel(containerApi)}
          className="border border-line-strong px-2 py-1 text-dim hover:text-text"
        >
          Load Quali duel layout
        </button>
        <AddWidgetMenu align="left" onPick={(w) => addWidget(containerApi, w, 'blue')} />
      </div>
    </div>
  );
}

export function Dashboard() {
  const setApi = useDashboardApi((s) => s.setApi);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const { api } = event;
      if (!restoreLayout(api)) applyQualiDuel(api);
      api.onDidLayoutChange(() => saveLayout(api));
      setApi(api);
    },
    [setApi]
  );

  return (
    <DockviewReact
      className="h-full"
      theme={theme}
      components={components}
      defaultTabComponent={PanelTab}
      rightHeaderActionsComponent={GroupActions}
      watermarkComponent={EmptyDashboard}
      onReady={onReady}
    />
  );
}
