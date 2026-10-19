import { useRef, useState } from 'react';
import { LayoutGrid, Plus, X } from 'lucide-react';
import { useDashboardApi } from '@/dashboard/api';
import { HeaderMenu } from '@/dashboard/HeaderMenu';
import { applyPreset, PRESETS, presetsFor, validLayout, type PresetId } from '@/dashboard/layout';
import { cn } from '@/lib/utils';
import {
  tabWorkspace,
  useDashboards,
  WORKSPACES,
  type DashboardTab,
  type UserPreset,
} from '@/store/dashboards';

const menuItem = 'block w-full px-2 py-1 text-left hover:bg-raised';

type Preset = (typeof PRESETS)[number];

const panelCount = (p: UserPreset) => Object.keys(p.layout.panels ?? {}).length;

/** The user's own presets, each with a button to delete it. */
function UserPresets({
  onPick,
  disabled,
}: {
  onPick: (preset: UserPreset) => void;
  disabled: boolean;
}) {
  const presets = useDashboards((s) => s.presets);
  const removePreset = useDashboards((s) => s.removePreset);
  if (presets.length === 0) return null;
  return (
    <>
      <div className="px-2 pb-0.5 pt-1.5 text-[10px] uppercase text-faint">Your presets</div>
      {presets.map((p) => (
        <div key={p.id} className="group flex items-start hover:bg-raised">
          <button
            type="button"
            disabled={disabled}
            className="min-w-0 flex-1 px-2 py-1 text-left"
            onClick={() => onPick(p)}
          >
            <div className="truncate text-text">{p.name}</div>
            <div className="text-[10px] text-faint">
              {panelCount(p)} panels, saved in {WORKSPACES.find((w) => w.id === p.workspace)?.title}
            </div>
          </button>
          <button
            type="button"
            title={`Delete the preset ${p.name}`}
            aria-label={`Delete the preset ${p.name}`}
            onClick={() => removePreset(p.id)}
            className="px-1.5 py-1.5 text-faint opacity-0 hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </>
  );
}

/** Save the dashboard on screen as a preset: a name, then Enter. */
function SavePreset({ name, onDone }: { name: string; onDone: () => void }) {
  const api = useDashboardApi((s) => s.api);
  const savePreset = useDashboards((s) => s.savePreset);
  const [naming, setNaming] = useState(false);
  if (!naming)
    return (
      <button type="button" disabled={!api} className={menuItem} onClick={() => setNaming(true)}>
        <div className="text-text">Save this dashboard as a preset…</div>
        <div className="text-[10px] text-faint">
          To start new dashboards from, in either workspace
        </div>
      </button>
    );
  return (
    <div className="px-2 py-1">
      <input
        autoFocus
        defaultValue={name}
        aria-label="Preset name"
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setNaming(false);
          if (e.key !== 'Enter' || !api) return;
          savePreset(e.currentTarget.value.trim() || name, api.toJSON());
          onDone();
        }}
        className="h-6 w-full border border-line-strong bg-transparent px-1.5 text-[11px] outline-none focus:border-dim"
      />
      <div className="pt-0.5 text-[10px] text-faint">Enter saves, Esc cancels</div>
    </div>
  );
}

/** The user's presets, a workspace's own presets, then the others under a faint heading. */
function PresetList({
  heading,
  onPick,
  onPickUser,
  disabled = false,
}: {
  heading: string;
  onPick: (preset: Preset) => void;
  onPickUser: (preset: UserPreset) => void;
  disabled?: boolean;
}) {
  const workspace = useDashboards((s) => s.workspace);
  const { own, other } = presetsFor(workspace);
  const item = (p: Preset) => (
    <button
      key={p.id}
      type="button"
      disabled={disabled}
      className={menuItem}
      onClick={() => onPick(p)}
    >
      <div className="text-text">{p.title}</div>
      <div className="text-[10px] text-faint">{p.description}</div>
    </button>
  );
  return (
    <>
      <div className="px-2 pb-0.5 pt-1 text-[10px] uppercase text-faint">{heading}</div>
      <UserPresets onPick={onPickUser} disabled={disabled} />
      <div className="px-2 pb-0.5 pt-1.5 text-[10px] uppercase text-faint">Built in</div>
      {own.map(item)}
      {other.length > 0 ? (
        <>
          <div className="px-2 pb-0.5 pt-1.5 text-[10px] uppercase text-faint">
            From the other workspace
          </div>
          {other.map(item)}
        </>
      ) : null}
    </>
  );
}

/** Dashboard tabs of this workspace in the top bar: each has its own layout. Double-click a tab
 * to rename it. */
export function DashboardTabs() {
  const {
    tabs: all,
    active,
    activate,
    rename,
    remove,
    add,
    addBlank,
    addFromPreset,
    duplicate,
    workspace,
  } = useDashboards();
  const tabs = all.filter((t) => tabWorkspace(t) === workspace);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex items-center" role="tablist" aria-label="Dashboards">
      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          className={cn(
            'group flex h-6 items-center border border-l-0 border-line-strong first:border-l',
            tab.id === active ? 'bg-raised text-text' : 'bg-panel text-dim hover:text-text'
          )}
        >
          {editing === tab.id ? (
            <input
              autoFocus
              defaultValue={tab.name}
              aria-label="Dashboard name"
              onBlur={(e) => {
                rename(tab.id, e.target.value.trim() || tab.name);
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setEditing(null);
              }}
              className="h-5 w-24 bg-transparent px-1.5 text-[11px] outline-none"
            />
          ) : (
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === active}
              title={
                i < 9 ? `${tab.name} (${i + 1}); double-click to rename` : 'Double-click to rename'
              }
              onClick={() => activate(tab.id)}
              onDoubleClick={() => setEditing(tab.id)}
              className="flex h-full items-center gap-1 px-2 text-[11px]"
            >
              {i < 9 ? <span className="text-[9px] tabular-nums text-faint">{i + 1}</span> : null}
              {tab.name}
            </button>
          )}
          {tabs.length > 1 ? (
            <button
              type="button"
              title={`Close ${tab.name}`}
              aria-label={`Close ${tab.name}`}
              onClick={() => remove(tab.id)}
              className="pr-1 text-faint opacity-0 hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      ))}
      <HeaderMenu icon={<Plus className="h-3.5 w-3.5" />} title="New dashboard" align="right">
        {(close) => (
          <div className="py-0.5">
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                duplicate(active);
              }}
            >
              <div className="text-text">Duplicate this dashboard</div>
              <div className="text-[10px] text-faint">A copy of this layout, to change</div>
            </button>
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                addBlank();
              }}
            >
              <div className="text-text">Empty dashboard</div>
              <div className="text-[10px] text-faint">No panels: add your own</div>
            </button>
            <SavePreset name={tabs.find((t) => t.id === active)?.name ?? 'Preset'} onDone={close} />
            <div className="my-0.5 border-t border-line" />
            <PresetList
              heading="New dashboard from"
              onPick={(p) => {
                close();
                add(p.title, p.id);
              }}
              onPickUser={(p) => {
                close();
                addFromPreset(p.id);
              }}
            />
          </div>
        )}
      </HeaderMenu>
    </div>
  );
}

type ExportFile = {
  app: 'f1dash';
  version: 1;
  dashboards: Omit<DashboardTab, 'id'>[];
  /** The user's presets (since 2026-10-19; older files have none). */
  presets?: Omit<UserPreset, 'id'>[];
};

type Imported = { tabs: Omit<DashboardTab, 'id'>[]; presets: Omit<UserPreset, 'id'>[] };

function parseExport(text: string): Imported | null {
  try {
    const data = JSON.parse(text) as Partial<ExportFile>;
    if (data.app !== 'f1dash' || !Array.isArray(data.dashboards)) return null;
    const presets = PRESETS.map((p) => p.id as string);
    const own = (Array.isArray(data.presets) ? data.presets : []).flatMap((p) => {
      const layout = p && typeof p.name === 'string' ? validLayout(p.layout) : null;
      if (!layout) return [];
      return [
        {
          name: p.name,
          layout,
          workspace: p.workspace === 'pitwall' ? p.workspace : 'analysis',
        } as const,
      ];
    });
    const tabs = data.dashboards
      .filter((d) => d && typeof d.name === 'string')
      .map((d) => ({
        name: d.name,
        layout: validLayout(d.layout),
        preset: (presets.includes(d.preset) ? d.preset : 'quali-duel') as PresetId,
        workspace:
          d.workspace === 'pitwall' || d.workspace === 'analysis' ? d.workspace : undefined,
        blank: d.blank === true ? true : undefined,
      }));
    return { tabs, presets: own };
  } catch {
    return null;
  }
}

/** Presets for the current tab, and export/import of all dashboards as a JSON file. */
export function LayoutMenu() {
  const api = useDashboardApi((s) => s.api);
  const importTabs = useDashboards((s) => s.importTabs);
  const replaceLayout = useDashboards((s) => s.replaceLayout);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  const flash = (message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 4000);
  };

  const exportAll = () => {
    const { tabs } = useDashboards.getState();
    const file: ExportFile = {
      app: 'f1dash',
      version: 1,
      dashboards: tabs.map((t) => ({
        name: t.name,
        layout: t.layout,
        preset: t.preset,
        workspace: tabWorkspace(t),
        blank: t.blank,
      })),
      presets: useDashboards.getState().presets.map(({ id: _id, ...p }) => p),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'f1dash-dashboards.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex items-center gap-1">
      {status ? <span className="text-[10px] text-dim">{status}</span> : null}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const imported = parseExport(await file.text());
          if (!imported || imported.tabs.length + imported.presets.length === 0)
            return flash('Not an f1dash dashboards file');
          importTabs(imported.tabs, imported.presets);
          const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;
          flash(
            `Imported ${count(imported.tabs.length, 'dashboard')}` +
              (imported.presets.length ? ` and ${count(imported.presets.length, 'preset')}` : '')
          );
        }}
      />
      <HeaderMenu icon={<LayoutGrid className="h-3.5 w-3.5" />} title="Layout" width="w-72">
        {(close) => (
          <div className="py-0.5">
            <PresetList
              heading="Replace this dashboard with"
              disabled={!api}
              onPick={(p) => {
                close();
                if (api) applyPreset(api, p.id);
              }}
              onPickUser={(p) => {
                close();
                replaceLayout(useDashboards.getState().active, p.layout);
              }}
            />
            <div className="my-0.5 border-t border-line" />
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                exportAll();
              }}
            >
              Export all dashboards and presets…
            </button>
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                fileRef.current?.click();
              }}
            >
              Import dashboards…
            </button>
          </div>
        )}
      </HeaderMenu>
    </div>
  );
}
