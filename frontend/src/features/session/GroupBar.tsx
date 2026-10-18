import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLaps, useSessionDetail } from '@/api/queries';
import { useLapsAtClock } from '@/widgets/useLapsAtClock';
import { formatLapTime } from '@/lib/format';
import { GROUP_COLORS, GROUP_IDS, useGroups } from '@/store/groups';

/** The laps selected per link group, removable, and whether they follow the newest laps. The
 * first lap of a group is the reference. */
export function GroupBar() {
  const groups = useGroups((s) => s.laps);
  const toggleLap = useGroups((s) => s.toggleLap);
  const follow = useGroups((s) => s.follow);
  const setFollow = useGroups((s) => s.setFollow);
  const laps = useLaps();
  const done = useLapsAtClock('app');
  const detail = useSessionDetail();

  const time = (driver: string, lap: number) =>
    laps.data?.find((l) => l.driver === driver && l.lap === lap)?.lap_time;
  // A selected lap the clock has not reached (the switch in the clock bar is on): kept, but faint.
  const ahead = (driver: string, lap: number) =>
    done.cut && !done.data?.some((l) => l.driver === driver && l.lap === lap);
  const color = (driver: string) => detail.data?.drivers.find((d) => d.code === driver)?.color;

  return (
    <div className="flex min-w-0 items-center gap-3 overflow-x-auto">
      {GROUP_IDS.filter((g) => groups[g].length > 0).map((g) => (
        <div key={g} className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 shrink-0" style={{ background: GROUP_COLORS[g] }} />
          {groups[g].map((ref, i) => (
            <span
              key={`${ref.driver}-${ref.lap}`}
              className={cn(
                'flex h-5 items-center gap-1 border border-line-strong bg-panel pl-1 text-[11px]',
                ahead(ref.driver, ref.lap) && 'opacity-40'
              )}
              title={
                ahead(ref.driver, ref.lap)
                  ? 'Not driven yet at the clock'
                  : i === 0
                    ? 'Reference lap'
                    : undefined
              }
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
          <button
            type="button"
            title={
              follow[g]
                ? 'Following the newest laps: picking a lap by hand stops it (l)'
                : 'Follow the newest laps: each driver moves to their newest lap at the clock, every lap (l)'
            }
            aria-pressed={follow[g]}
            onClick={() => setFollow(g, !follow[g])}
            className={cn(
              'h-5 border px-1 text-[9px] font-semibold tracking-wider',
              follow[g]
                ? 'border-line-strong bg-raised text-text'
                : 'border-transparent text-faint hover:text-text'
            )}
          >
            FOLLOW
          </button>
        </div>
      ))}
    </div>
  );
}
