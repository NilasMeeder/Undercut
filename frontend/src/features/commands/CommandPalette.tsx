import { useEffect, useMemo, useRef, useState } from 'react';
import { useLaps } from '@/api/queries';
import { useActiveLinkGroup, useDashboardApi } from '@/dashboard/api';
import { cn } from '@/lib/utils';
import { GROUP_COLORS } from '@/store/groups';
import { buildCommands, type Command } from './commands';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * ⌘K / Ctrl+K opens a searchable list of every command; single-key shortcuts run them directly.
 * Both act on the link group of the focused panel.
 */
export function CommandPalette() {
  const api = useDashboardApi((s) => s.api);
  const group = useActiveLinkGroup();
  const laps = useLaps();
  const [open, setOpen] = useState(false);

  const commands = useMemo(
    () => buildCommands({ api, group, laps: laps.data ?? [] }),
    [api, group, laps.data]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (open || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const command = commands.find((c) => c.key === e.key);
      if (command) {
        e.preventDefault();
        command.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commands, open]);

  return (
    <>
      <button
        type="button"
        title="Commands and shortcuts (⌘K)"
        onClick={() => setOpen(true)}
        className="flex h-6 items-center gap-1 border border-line-strong px-1.5 text-[11px] text-faint hover:text-text"
      >
        Commands <span className="text-[10px]">⌘K</span>
      </button>
      {open ? <Palette commands={commands} group={group} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Palette({
  commands,
  group,
  onClose,
}: {
  commands: Command[];
  group: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) =>
      words.every((w) => `${c.section} ${c.title}`.toLowerCase().includes(w))
    );
  }, [commands, query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  return (
    <div className="fixed inset-0 z-[100] flex justify-center bg-bg/70 pt-24" onClick={onClose}>
      <div
        className="flex h-fit max-h-[60vh] w-[520px] flex-col border border-line-strong bg-header"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-2">
          <span
            className="h-2.5 w-2.5 shrink-0"
            style={{ background: GROUP_COLORS[group as keyof typeof GROUP_COLORS] }}
            title={`Acts on the ${group} link group`}
          />
          <input
            autoFocus
            value={query}
            placeholder="Type a command or a driver…"
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, matches.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') run(matches[index]);
            }}
            className="h-8 flex-1 bg-transparent text-[12px] text-text outline-none placeholder:text-faint"
          />
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-auto py-0.5 text-[11px]">
          {matches.length === 0 ? (
            <div className="px-2 py-1 text-faint">No commands match.</div>
          ) : (
            matches.map((c, i) => (
              <button
                key={c.id}
                type="button"
                data-active={i === index}
                onMouseEnter={() => setIndex(i)}
                onClick={() => run(c)}
                className={cn(
                  'flex w-full items-center gap-2 px-2 py-1 text-left',
                  i === index && 'bg-raised'
                )}
              >
                <span className="w-14 shrink-0 text-[10px] uppercase text-faint">{c.section}</span>
                <span className="flex-1 text-text">{c.title}</span>
                {c.key ? (
                  <kbd className="border border-line-strong px-1 font-mono text-[10px] text-dim">
                    {c.key}
                  </kbd>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
