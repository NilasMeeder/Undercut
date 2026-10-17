import { useMemo, useState } from 'react';
import type { MarkerIn } from '@/api/client';
import { useDeleteMarker, useMarkerTags, useSaveMarker } from '@/api/markers';
import { useSessionDetail, useTimeline } from '@/api/queries';
import { describeTime, SUGGESTED_TAGS } from '@/lib/markers';
import { formatClock } from '@/lib/replay';
import { cn } from '@/lib/utils';
import { useGroups, type LapRef } from '@/store/groups';
import { useMarkerEditor, type MarkerDraft } from '@/store/markerEditor';

const input =
  'h-6 border border-line-strong bg-panel px-1.5 text-[11px] text-text outline-none focus:border-dim';
const NO_LAPS: LapRef[] = [];
const label = 'w-12 shrink-0 text-[10px] uppercase text-faint';

/** The marker editor: one dialog for the whole app, opened from charts, the clock bar or keys. */
export function MarkerEditor() {
  const draft = useMarkerEditor((s) => s.draft);
  const seq = useMarkerEditor((s) => s.seq);
  return draft ? <Editor key={seq} draft={draft} /> : null;
}

function parseMetres(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() === '' || !Number.isFinite(value) ? null : value;
}

function Editor({ draft }: { draft: MarkerDraft }) {
  const close = useMarkerEditor((s) => s.close);
  const groupLaps = useGroups((s) => (draft.group ? s.laps[draft.group] : NO_LAPS));
  const detail = useSessionDetail();
  const timeline = useTimeline();
  const usedTags = useMarkerTags();
  const save = useSaveMarker();
  const remove = useDeleteMarker();

  const [from, setFrom] = useState(draft.start == null ? '' : String(Math.round(draft.start)));
  const [to, setTo] = useState(draft.end == null ? '' : String(Math.round(draft.end)));
  const [lap, setLap] = useState(draft.driver ? `${draft.driver}:${draft.lap ?? ''}` : '');
  const [note, setNote] = useState(draft.note);
  const [tags, setTags] = useState(draft.tags);
  const [newTag, setNewTag] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isDistance = draft.kind === 'distance';
  const lapOptions = useMemo(() => {
    if (!isDistance) return (detail.data?.drivers ?? []).map((d) => `${d.code}:`);
    const options = groupLaps.map((l) => `${l.driver}:${l.lap}`);
    if (draft.driver && draft.lap != null && !options.includes(`${draft.driver}:${draft.lap}`))
      options.push(`${draft.driver}:${draft.lap}`);
    return options;
  }, [isDistance, detail.data, groupLaps, draft.driver, draft.lap]);
  const tagOptions = useMemo(() => {
    const all = [...(usedTags.data ?? []).map((t) => t.tag), ...SUGGESTED_TAGS];
    const lower = new Set(tags.map((t) => t.toLowerCase()));
    return [...new Map(all.map((t) => [t.toLowerCase(), t])).values()]
      .filter((t) => !lower.has(t.toLowerCase()))
      .slice(0, 14);
  }, [usedTags.data, tags]);

  const start = isDistance ? parseMetres(from) : draft.start;
  const end = isDistance ? parseMetres(to) : draft.end;
  const problem =
    start == null
      ? 'Type where the marker starts (m).'
      : start < 0
        ? 'A distance starts at 0 m or later.'
        : end != null && end < start
          ? 'The end is before the start.'
          : null;

  const addTag = (tag: string) => {
    const clean = tag.trim();
    if (clean && !tags.some((t) => t.toLowerCase() === clean.toLowerCase()))
      setTags([...tags, clean]);
    setNewTag('');
  };

  const submit = async () => {
    if (problem || start == null) return;
    const [driver, lapNumber] = lap ? lap.split(':') : [null, ''];
    const marker: MarkerIn = {
      kind: draft.kind,
      start,
      end: end === start ? null : end,
      driver,
      lap: lapNumber ? Number(lapNumber) : null,
      note: note.trim(),
      tags: newTag.trim() ? [...tags, newTag.trim()] : tags,
    };
    await save.mutateAsync({ id: draft.id, marker });
    close();
  };

  const place = isDistance
    ? null
    : draft.end == null
      ? describeTime(timeline.data, draft.start ?? 0)
      : `${describeTime(timeline.data, draft.start ?? 0)}, for ${formatClock((draft.end ?? 0) - (draft.start ?? 0))}`;
  const error = save.error ?? remove.error;

  return (
    <div className="fixed inset-0 z-[100] flex justify-center bg-bg/70 pt-24" onClick={close}>
      <form
        className="flex h-fit w-[440px] flex-col gap-1.5 border border-line-strong bg-header p-2 text-[11px]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-dim">
            {draft.id == null ? 'New' : 'Edit'} {isDistance ? 'distance marker' : 'time marker'}
          </span>
          <span className="text-[10px] text-faint">Enter saves, Esc cancels</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className={label}>{isDistance ? 'Where' : 'When'}</span>
          {isDistance ? (
            <>
              <input
                aria-label="From (m)"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                inputMode="decimal"
                className={cn(input, 'w-16 text-right')}
              />
              <span className="text-faint">to</span>
              <input
                aria-label="To (m), empty for a point"
                placeholder="point"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                inputMode="decimal"
                className={cn(input, 'w-16 text-right placeholder:text-faint')}
              />
              <span className="text-faint">m</span>
            </>
          ) : (
            <span className="tabular-nums text-text">{place}</span>
          )}
        </div>

        <label className="flex items-center gap-1.5">
          <span className={label}>{isDistance ? 'Lap' : 'Driver'}</span>
          <select
            value={lap}
            onChange={(e) => setLap(e.target.value)}
            className={cn(input, 'w-40')}
          >
            <option value="">{isDistance ? 'Any lap' : 'No driver'}</option>
            {lapOptions.map((o) => (
              <option key={o} value={o}>
                {o.endsWith(':') ? o.slice(0, -1) : o.replace(':', ' L')}
              </option>
            ))}
          </select>
          {isDistance && lapOptions.length === 0 ? (
            <span className="text-faint">Select laps to attach the marker to one.</span>
          ) : null}
        </label>

        <label className="flex items-center gap-1.5">
          <span className={label}>Note</span>
          <input
            autoFocus
            value={note}
            maxLength={500}
            placeholder="What happens here"
            onChange={(e) => setNote(e.target.value)}
            className={cn(input, 'flex-1 placeholder:text-faint')}
          />
        </label>

        <div className="flex items-start gap-1.5">
          <span className={cn(label, 'pt-1')}>Tags</span>
          <div className="flex flex-1 flex-wrap items-center gap-1">
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                title="Remove tag"
                onClick={() => setTags(tags.filter((x) => x !== t))}
                className="h-5 border border-dim bg-raised px-1.5 text-text"
              >
                {t} ×
              </button>
            ))}
            {tagOptions.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => addTag(t)}
                className="h-5 border border-line-strong px-1.5 text-faint hover:text-text"
              >
                {t}
              </button>
            ))}
            <input
              aria-label="New tag"
              value={newTag}
              placeholder="new tag"
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ',') && newTag.trim()) {
                  e.preventDefault();
                  addTag(newTag);
                }
              }}
              className={cn(input, 'h-5 w-24 placeholder:text-faint')}
            />
          </div>
        </div>

        <div className="flex items-center gap-1.5 pt-1">
          {draft.id != null ? (
            <button
              type="button"
              onClick={async () => {
                if (!confirmDelete) return setConfirmDelete(true);
                await remove.mutateAsync(draft.id!);
                close();
              }}
              className="h-6 border border-line-strong px-2 text-pit hover:bg-raised"
            >
              {confirmDelete ? 'Click again to delete' : 'Delete'}
            </button>
          ) : null}
          <span className={cn('min-w-0 flex-1 truncate', error ? 'text-pit' : 'text-faint')}>
            {error ? error.message : (problem ?? '')}
          </span>
          <button
            type="button"
            onClick={close}
            className="h-6 border border-line-strong px-2 text-dim hover:text-text"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={problem != null || save.isPending}
            className="h-6 border border-dim bg-raised px-3 text-text disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
