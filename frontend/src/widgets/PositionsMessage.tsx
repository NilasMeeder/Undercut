import type { ReplayStatus } from '@/api/client';
import { PanelMessage } from '@/components/data/bits';

/** Shown while the position track is prepared (once per session). */
export function PositionsMessage({
  status,
  error,
}: {
  status?: ReplayStatus;
  error: Error | null;
}) {
  if (error) return <PanelMessage>{error.message}</PanelMessage>;
  if (status?.state === 'error')
    return <PanelMessage>Preparing the positions failed: {status.error}</PanelMessage>;
  const percent = Math.round((status?.progress ?? 0) * 100);
  return (
    <PanelMessage>
      <span className="flex flex-col items-center gap-1.5">
        <span>
          {status?.phase ?? 'Preparing positions'}… {percent}%
        </span>
        <span className="h-1 w-40 bg-raised">
          <span className="block h-full bg-dim" style={{ width: `${percent}%` }} />
        </span>
        <span className="text-[10px]">
          Once per session: the telemetry of every lap is downloaded and kept on disk.
        </span>
      </span>
    </PanelMessage>
  );
}
