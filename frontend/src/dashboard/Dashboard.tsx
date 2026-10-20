import { Suspense, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  DockviewReact,
  type DockviewApi,
  type DockviewGroupPanel,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewHeaderActionsProps,
  type IDockviewPanel,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from 'dockview-react';
import { ExternalLink, Info, PanelTopClose, Plus, Settings, X } from 'lucide-react';
import { PanelMessage } from '@/components/data/bits';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { asGroup, GROUP_COLORS, nextGroup, type GroupId } from '@/store/groups';
import { WIDGETS, WIDGETS_BY_ID } from '@/widgets/registry';
import { diffFromDefaults, resolveConfig, type WidgetConfig } from '@/widgets/types';
import { useDashboardApi } from './api';
import { HeaderMenu, headerButton } from './HeaderMenu';
import { useDashboards, type DashboardTab } from '@/store/dashboards';
import { addWidget, applyPreset, validLayout, type PanelParams } from './layout';
import { HelpContent, SettingsContent } from './PanelMenus';

const theme: DockviewTheme = {
  name: 'pitwall',
  className: 'dockview-theme-pitwall',
  colorScheme: 'dark',
  gap: 1,
};

const components = Object.fromEntries(
  WIDGETS.map((widget) => {
    const Widget = widget.component;
    const Panel = ({ api, params }: IDockviewPanelProps<PanelParams>) => {
      // Stable identity until the panel's settings change, so charts are not rebuilt per render.
      const config = useMemo(() => resolveConfig(widget, params.config), [params.config]);
      const setConfig = useCallback(
        (patch: WidgetConfig) =>
          api.updateParameters({
            config: diffFromDefaults({ ...config, ...patch }, widget.defaults),
          }),
        [api, config]
      );
      return (
        <ErrorBoundary
          fallback={(error, retry) => (
            <PanelMessage>
              This panel failed: {error.message}{' '}
              <button className="underline" onClick={retry}>
                Try again
              </button>
            </PanelMessage>
          )}
        >
          <Suspense fallback={<PanelMessage>Loading…</PanelMessage>}>
            <Widget group={asGroup(params.group)} config={config} setConfig={setConfig} />
          </Suspense>
        </ErrorBoundary>
      );
    };
    Panel.displayName = `Panel(${widget.id})`;
    return [widget.id, Panel];
  })
);

/** On the pitwall the board is locked unless editing. */
const useLocked = () => useDashboards((s) => s.workspace === 'pitwall' && !s.editing);

/** Tab: link-group square (click to cycle groups), title, close. */
function PanelTab({ api, params }: IDockviewPanelHeaderProps<PanelParams>) {
  const group: GroupId = asGroup(params.group);
  const locked = useLocked();
  if (locked)
    return (
      <div className="flex h-full items-center gap-1.5 pl-1.5 pr-2 text-[11px]">
        <span className="h-2.5 w-2.5 shrink-0" style={{ background: GROUP_COLORS[group] }} />
        <span className="truncate">{api.title}</span>
      </div>
    );
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
  return (
    <HeaderMenu icon={<Plus className="h-3.5 w-3.5" />} title="Add panel" align={align}>
      {(close) => (
        <div className="py-0.5">
          {WIDGETS.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => {
                close();
                onPick(w.id);
              }}
              className="block w-full px-2 py-1 text-left hover:bg-raised"
            >
              <div className="text-text">{w.title}</div>
              <div className="text-[10px] text-faint">{w.description}</div>
            </button>
          ))}
        </div>
      )}
    </HeaderMenu>
  );
}

/** A panel's params, re-read whenever they change (link group, settings). */
function usePanelParams(panel: IDockviewPanel | undefined): PanelParams | undefined {
  return useSyncExternalStore(
    (fn) => {
      const sub = panel?.api.onDidParametersChange(fn);
      return () => sub?.dispose();
    },
    () => panel?.params as PanelParams | undefined
  );
}

function useGroupLocation(group: DockviewGroupPanel) {
  return useSyncExternalStore(
    (fn) => {
      const sub = group.api.onDidLocationChange(fn);
      return () => sub.dispose();
    },
    () => group.api.location
  );
}

/** Title-bar buttons of a tab group; help and settings act on the visible panel. A locked board
 * (Pitwall) keeps help and settings: only adding, closing and popping out change the layout. */
function GroupActions({ containerApi, group, activePanel }: IDockviewHeaderActionsProps) {
  const locked = useLocked();
  const params = usePanelParams(activePanel);
  const location = useGroupLocation(group);
  const widget = activePanel ? WIDGETS_BY_ID.get(activePanel.api.component) : undefined;
  const config = useMemo(
    () => (widget ? resolveConfig(widget, params?.config) : undefined),
    [widget, params?.config]
  );
  const linkGroup = asGroup(params?.group);

  return (
    <div className="flex h-full items-center">
      {locked ? null : (
        <AddWidgetMenu
          onPick={(id) => addWidget(containerApi, id, linkGroup, { referenceGroup: group })}
        />
      )}
      {widget ? (
        <HeaderMenu
          icon={<Info className="h-3 w-3" />}
          title={`About ${widget.title}`}
          width="w-80"
        >
          {() => <HelpContent widget={widget} />}
        </HeaderMenu>
      ) : null}
      {widget && config && widget.settings.length > 0 ? (
        <HeaderMenu
          icon={<Settings className="h-3 w-3" />}
          title={`${widget.title} settings`}
          width="w-80"
        >
          {() => (
            <SettingsContent
              widget={widget}
              config={config}
              onChange={(stored) => activePanel?.api.updateParameters({ config: stored })}
            />
          )}
        </HeaderMenu>
      ) : null}
      {locked ? null : location.type === 'popout' ? (
        <button
          type="button"
          title="Back to the dashboard"
          aria-label="Back to the dashboard"
          // Closing the window hands the group back to the main grid where it came from.
          onClick={() => location.getWindow().close()}
          className={headerButton}
        >
          <PanelTopClose className="h-3 w-3" />
        </button>
      ) : (
        <button
          type="button"
          title="Open in a separate window"
          aria-label="Open in a separate window"
          onClick={() => void containerApi.addPopoutGroup(group)}
          className={headerButton}
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      )}
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
          onClick={() => applyPreset(containerApi, 'quali-duel')}
          className="border border-line-strong px-2 py-1 text-dim hover:text-text"
        >
          Load Quali duel layout
        </button>
        <AddWidgetMenu align="left" onPick={(w) => addWidget(containerApi, w, 'blue')} />
      </div>
    </div>
  );
}

/** Show a tab: its saved layout if it still loads, otherwise its preset (or nothing, if it
 * started empty). */
function loadTab(api: DockviewApi, tab: DashboardTab | undefined) {
  const layout = validLayout(tab?.layout);
  if (tab?.blank && !layout) {
    api.clear();
    return;
  }
  if (layout) {
    try {
      api.fromJSON(layout);
      if (api.panels.length > 0) return;
    } catch {
      // A layout from an older version that dockview rejects: fall back to the preset.
    }
  }
  applyPreset(api, tab?.preset ?? 'quali-duel');
}

export function Dashboard() {
  const api = useDashboardApi((s) => s.api);
  const setApi = useDashboardApi((s) => s.setApi);
  const active = useDashboards((s) => s.active);
  const reload = useDashboards((s) => s.reload);
  const locked = useLocked();

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const { api } = event;
      // Every change is saved into whichever tab is active at that moment.
      api.onDidLayoutChange(() => {
        const { active, saveLayout } = useDashboards.getState();
        saveLayout(active, api.toJSON());
      });
      setApi(api);
    },
    [setApi]
  );

  useEffect(() => {
    if (api)
      loadTab(
        api,
        useDashboards.getState().tabs.find((t) => t.id === active)
      );
  }, [api, active, reload]);

  return (
    <DockviewReact
      className="h-full"
      theme={theme}
      components={components}
      defaultTabComponent={PanelTab}
      rightHeaderActionsComponent={GroupActions}
      watermarkComponent={EmptyDashboard}
      onReady={onReady}
      locked={locked}
      disableDnd={locked}
    />
  );
}
