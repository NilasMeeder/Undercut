import { Pause, Play } from 'lucide-react';
import { useState } from 'react';
import { radioUrl, type Transcription } from '@/api/client';
import { useSessionDetail, useTeamRadio, useTimeline } from '@/api/queries';
import { useTranscription } from '@/api/transcription';
import { DriverCell, PanelMessage } from '@/components/data/bits';
import { momentLabel } from '@/lib/replay';
import { td } from '@/lib/table';
import { cn } from '@/lib/utils';
import { useClockTime } from '@/store/clock';
import { useRadio, type RadioAutoplay } from '@/store/radio';
import { sessionPath, useSessionKey } from '@/store/selection';
import type { WidgetProps } from '../types';
import { useGroupDrivers } from '../useStrategy';
import type { RadioConfig } from './widget';

const timeOfDay = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const AUTOPLAY: { value: RadioAutoplay; label: string; title: string }[] = [
  { value: 'off', label: 'OFF', title: 'Clips only play when clicked' },
  { value: 'group', label: 'GROUP', title: 'Play the link groups’ drivers as the clock passes' },
  { value: 'all', label: 'ALL', title: 'Play every car’s clips as the clock passes' },
];

export function RadioWidget({ group, config }: WidgetProps<RadioConfig>) {
  const key = useSessionKey();
  const clips = useTeamRadio();
  const timeline = useTimeline().data;
  const drivers = useSessionDetail().data?.drivers;
  const selected = useGroupDrivers(group);
  const t = useClockTime(500);
  const { playing, autoplay, play, stop, setAutoplay } = useRadio();
  const transcription = useTranscription(clips.data != null && clips.data.length > 0);
  const [search, setSearch] = useState('');

  if (clips.error) return <PanelMessage>{clips.error.message}</PanelMessage>;
  if (!clips.data || !drivers || !key) return <PanelMessage>Loading team radio…</PanelMessage>;
  const race = key.session === 'R' || key.session === 'S';
  const words = search.trim().toLowerCase();
  const shown = clips.data
    .filter((c) => c.t != null && c.t <= t)
    .filter((c) => config.drivers === 'all' || selected.includes(c.driver))
    .filter(
      (c) =>
        !words || (c.text ?? '').toLowerCase().includes(words) || c.driver === words.toUpperCase()
    )
    .reverse();
  const texts = config.text && clips.data.some((c) => c.text);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-1.5 py-0.5 text-[10px] text-faint">
        <span>AUTO</span>
        {AUTOPLAY.map((a) => (
          <button
            key={a.value}
            type="button"
            title={a.title}
            onClick={() => setAutoplay(a.value)}
            className={cn('font-semibold', a.value === autoplay ? 'text-text' : 'hover:text-dim')}
          >
            {a.label}
          </button>
        ))}
        <TranscribeButton
          status={transcription.status.data}
          pending={transcription.start.isPending}
          onStart={() => transcription.start.mutate()}
        />
        {clips.data.some((c) => c.text) ? (
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search what is said"
            className="h-4 w-36 border border-line bg-bg px-1 text-[10px] text-text placeholder:text-faint"
          />
        ) : null}
        <span className="ml-auto">
          {shown.length} of {clips.data.length} clips
        </span>
      </div>
      {transcription.start.error ? (
        <p className="px-1.5 text-[10px] text-pit">{transcription.start.error.message}</p>
      ) : null}
      {shown.length === 0 ? (
        <PanelMessage>
          {clips.data.length === 0
            ? 'No team radio for this session.'
            : words
              ? 'Nothing found at the session clock.'
              : 'No team radio yet at the session clock.'}
        </PanelMessage>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full whitespace-nowrap text-[11px] tabular-nums">
            <tbody>
              {shown.map((c) => {
                const on = playing === c.id;
                return (
                  <tr
                    key={c.id}
                    onClick={() => (on ? stop() : play(c.id, radioUrl(sessionPath(key), c.id)))}
                    className={cn('cursor-pointer hover:bg-raised', on && 'bg-raised')}
                    title={on ? 'Stop' : 'Listen'}
                  >
                    <td className="w-5 px-1.5 py-[1px]">
                      {on ? (
                        <Pause className="h-3 w-3 text-text" />
                      ) : (
                        <Play className="h-3 w-3 text-faint" />
                      )}
                    </td>
                    <DriverCell code={c.driver} drivers={drivers} />
                    <td className={cn(td, 'text-dim')}>{momentLabel(c.t!, timeline, race)}</td>
                    <td className={cn(td, 'text-faint')}>{timeOfDay.format(new Date(c.utc))}</td>
                    {texts ? (
                      <td
                        className={cn(
                          'w-full whitespace-normal px-1.5 py-[1px] text-left leading-snug',
                          c.text ? 'text-text' : 'text-faint'
                        )}
                      >
                        {c.text == null ? '' : c.text || '(not understood)'}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Transcribe the session's radio on this computer, or how far that is. */
function TranscribeButton({
  status,
  pending,
  onStart,
}: {
  status: Transcription | undefined;
  pending: boolean;
  onStart: () => void;
}) {
  if (!status || status.total === 0) return null;
  if (status.state === 'running') {
    return (
      <span className="text-dim" title={`Whisper (${status.model}) on this computer`}>
        TEXT {status.done}/{status.total}
      </span>
    );
  }
  if (status.state === 'done' && status.done === status.total) return null;
  const ready = status.engine != null;
  return (
    <button
      type="button"
      disabled={!ready || pending}
      onClick={onStart}
      className="font-semibold hover:text-text disabled:opacity-40"
      title={
        ready
          ? `Write out what is said in every clip, on this computer (Whisper, ${status.model}). ` +
            `About a second per clip${status.error ? `. Last time: ${status.error}` : ''}.`
          : 'Needs Whisper: in backend/, uv sync --group transcribe (make install does)'
      }
    >
      {status.state === 'error' ? 'TEXT: RETRY' : 'TRANSCRIBE'}
    </button>
  );
}
