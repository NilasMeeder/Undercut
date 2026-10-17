import { useRef, useState } from 'react';
import { LayoutGrid, Plus, X } from 'lucide-react';
import { useDashboardApi } from '@/dashboard/api';
import { HeaderMenu } from '@/dashboard/HeaderMenu';
import { applyPreset, PRESETS, validLayout, type PresetId } from '@/dashboard/layout';
import { cn } from '@/lib/utils';
import { useDashboards, type DashboardTab } from '@/store/dashboards';

const menuItem = 'block w-full px-2 py-1 text-left hover:bg-raised';

/** Dashboard tabs in the top bar: each has its own layout. Double-click a tab to rename it. */
export function DashboardTabs() {
  const { tabs, active, activate, rename, remove, add } = useDashboards();
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex items-center" role="tablist" aria-label="Dashboards">
      {tabs.map((tab) => (
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
              title="Double-click to rename"
              onClick={() => activate(tab.id)}
              onDoubleClick={() => setEditing(tab.id)}
              className="h-full px-2 text-[11px]"
            >
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
            <div className="px-2 pb-0.5 pt-1 text-[10px] uppercase text-faint">
              New dashboard from
            </div>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={menuItem}
                onClick={() => {
                  close();
                  add(p.title, p.id);
                }}
              >
                <div className="text-text">{p.title}</div>
                <div className="text-[10px] text-faint">{p.description}</div>
              </button>
            ))}
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
};

function parseExport(text: string): Omit<DashboardTab, 'id'>[] | null {
  try {
    const data = JSON.parse(text) as Partial<ExportFile>;
    if (data.app !== 'f1dash' || !Array.isArray(data.dashboards)) return null;
    const presets = PRESETS.map((p) => p.id as string);
    return data.dashboards
      .filter((d) => d && typeof d.name === 'string')
      .map((d) => ({
        name: d.name,
        layout: validLayout(d.layout),
        preset: (presets.includes(d.preset) ? d.preset : 'quali-duel') as PresetId,
      }));
  } catch {
    return null;
  }
}

/** Presets for the current tab, and export/import of all dashboards as a JSON file. */
export function LayoutMenu() {
  const api = useDashboardApi((s) => s.api);
  const importTabs = useDashboards((s) => s.importTabs);
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
      dashboards: tabs.map(({ name, layout, preset }) => ({ name, layout, preset })),
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
          const tabs = parseExport(await file.text());
          if (!tabs || tabs.length === 0) return flash('Not an f1dash dashboards file');
          importTabs(tabs);
          flash(`Imported ${tabs.length} dashboard${tabs.length > 1 ? 's' : ''}`);
        }}
      />
      <HeaderMenu icon={<LayoutGrid className="h-3.5 w-3.5" />} title="Layout" width="w-72">
        {(close) => (
          <div className="py-0.5">
            <div className="px-2 pb-0.5 pt-1 text-[10px] uppercase text-faint">
              Replace this dashboard with
            </div>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={!api}
                className={menuItem}
                onClick={() => {
                  close();
                  if (api) applyPreset(api, p.id);
                }}
              >
                <div className="text-text">{p.title}</div>
                <div className="text-[10px] text-faint">{p.description}</div>
              </button>
            ))}
            <div className="my-0.5 border-t border-line" />
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                exportAll();
              }}
            >
              Export all dashboards…
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
