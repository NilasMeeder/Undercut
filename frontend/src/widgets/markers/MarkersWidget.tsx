import { useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import { useAllMarkers } from '@/api/markers';
import { useTimeline } from '@/api/queries';
import { PanelMessage } from '@/components/data/bits';
import { jumpToMarker, markDistance, markMoment } from '@/features/markers/actions';
import { isAuto } from '@/lib/autoMarkers';
import { describePlace, markerLap } from '@/lib/markers';
import { useAutoMarkersOn } from '@/store/autoMarkers';
import { cn } from '@/lib/utils';
import { editMarker } from '@/store/markerEditor';
import type { WidgetProps } from '../types';
import type { MarkersConfig } from './widget';

export function MarkersWidget({ group, config }: WidgetProps<MarkersConfig>) {
  const markers = useAllMarkers();
  const timeline = useTimeline();
  const { on: auto, setOn: setAuto } = useAutoMarkersOn();
  const [tag, setTag] = useState<string | null>(null);

  const ofKind = useMemo(
    () => (markers.data ?? []).filter((m) => config.kinds.includes(m.kind)),
    [markers.data, config.kinds]
  );
  const tags = useMemo(() => [...new Set(ofKind.flatMap((m) => m.tags))].sort(), [ofKind]);
  const shown = tag ? ofKind.filter((m) => m.tags.includes(tag)) : ofKind;

  if (markers.error) return <PanelMessage>{markers.error.message}</PanelMessage>;
  if (!markers.data) return <PanelMessage>Loading markers…</PanelMessage>;

  const button = 'h-5 border border-line-strong px-1.5 text-dim hover:text-text';
  return (
    <div className="flex h-full flex-col text-[11px]">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-1.5 py-1">
        <button type="button" className={button} onClick={() => markDistance(group)}>
          Mark distance <span className="text-faint">m</span>
        </button>
        <button type="button" className={button} onClick={markMoment}>
          Mark moment <span className="text-faint">⇧M</span>
        </button>
        <button
          type="button"
          aria-pressed={auto}
          title="Automatic markers: what the session report finds (race moments, and where each driver's best lap loses most). Not stored; the pencil keeps one as a marker."
          onClick={() => setAuto(!auto)}
          className={cn(button, auto && 'border-dim bg-raised text-text')}
        >
          AUTO
        </button>
        {tags.length > 0 ? (
          <span className="ml-1 text-[10px] uppercase text-faint">Tag</span>
        ) : null}
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tag === t}
            onClick={() => setTag(tag === t ? null : t)}
            className={cn(
              'h-5 border px-1.5',
              tag === t ? 'border-dim bg-raised text-text' : 'border-line-strong text-faint'
            )}
          >
            {t}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <PanelMessage>
          {ofKind.length === 0
            ? 'No markers yet. Shift + drag in a chart marks a range, Shift+M marks the moment.'
            : 'No markers with this tag.'}
        </PanelMessage>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-panel text-[10px] uppercase text-faint">
              <tr>
                <th className="px-1.5 text-left font-medium">Where</th>
                <th className="px-1.5 text-left font-medium">Lap</th>
                <th className="w-full px-1.5 text-left font-medium">Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr
                  key={m.id}
                  tabIndex={0}
                  title="Go there"
                  onClick={() => jumpToMarker(m, group)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') jumpToMarker(m, group);
                  }}
                  className="group cursor-pointer hover:bg-raised focus-visible:bg-raised focus-visible:outline-none"
                >
                  <td className="whitespace-nowrap px-1.5 py-[2px] tabular-nums">
                    <span className="mr-1.5 text-[10px] text-faint">
                      {m.kind === 'distance' ? 'DIST' : 'TIME'}
                    </span>
                    {describePlace(m, timeline.data)}
                  </td>
                  <td className="whitespace-nowrap px-1.5 text-dim">{markerLap(m)}</td>
                  <td className="max-w-0 px-1.5">
                    <div className="flex items-center gap-1.5">
                      {m.tags.map((t) => (
                        <span key={t} className="shrink-0 border border-line-strong px-1 text-dim">
                          {t}
                        </span>
                      ))}
                      <span className="truncate" title={m.note}>
                        {m.note}
                      </span>
                    </div>
                  </td>
                  <td className="px-1">
                    <button
                      type="button"
                      title={isAuto(m) ? 'Keep as a marker' : 'Edit or delete'}
                      aria-label={isAuto(m) ? 'Keep marker' : 'Edit marker'}
                      onClick={(e) => {
                        e.stopPropagation();
                        editMarker(m, group);
                      }}
                      className="flex h-5 w-5 items-center justify-center text-faint opacity-0 hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
