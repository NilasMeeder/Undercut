import { X } from 'lucide-react';
import { useLaps, useSessionDetail } from '@/api/queries';
import { formatLapTime } from '@/lib/format';
import { GROUP_COLORS, GROUP_IDS, useGroups } from '@/store/groups';

/** The laps selected per link group, removable. The first lap of a group is the reference. */
export function GroupBar() {
  const groups = useGroups((s) => s.laps);
  const toggleLap = useGroups((s) => s.toggleLap);
  const laps = useLaps();
  const detail = useSessionDetail();

  const time = (driver: string, lap: number) =>
    laps.data?.find((l) => l.driver === driver && l.lap === lap)?.lap_time;
  const color = (driver: string) => detail.data?.drivers.find((d) => d.code === driver)?.color;

  return (
    <div className="flex min-w-0 items-center gap-3 overflow-x-auto">
      {GROUP_IDS.filter((g) => groups[g].length > 0).map((g) => (
        <div key={g} className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 shrink-0" style={{ background: GROUP_COLORS[g] }} />
          {groups[g].map((ref, i) => (
            <span
              key={`${ref.driver}-${ref.lap}`}
              className="flex h-5 items-center gap-1 border border-line-strong bg-panel pl-1 text-[11px]"
              title={i === 0 ? 'Reference lap' : undefined}
            >
              <span className="h-2.5 w-[3px]" style={{ background: color(ref.driver) }} />
              <span className="font-semibold">{ref.driver}</span>
              <span className="text-faint">L{ref.lap}</span>
              <span className="text-dim">{formatLapTime(time(ref.driver, ref.lap))}</span>
              {i === 0 ? <span className="text-[9px] text-faint">REF</span> : null}
              <button
                type="button"
                title="Remove"
                onClick={() => toggleLap(g, ref)}
                className="px-0.5 text-faint hover:text-text"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
