import { useLiveSessions } from '@/api/live';
import { useSelection, useSessionKey } from '@/store/selection';

/** A session in progress that is not on screen: one click to go there. */
export function LiveBadge() {
  const sessions = useLiveSessions();
  const key = useSessionKey();
  const live = (sessions.data ?? []).filter(
    (s) =>
      s.state === 'live' &&
      !(key && s.year === key.year && s.round === key.round && s.code === key.session)
  );
  if (live.length === 0) return null;
  return (
    <>
      {live.map((s) => (
        <button
          key={`${s.year}-${s.round}-${s.code}`}
          type="button"
          onClick={() => useSelection.setState({ year: s.year, round: s.round, session: s.code })}
          title={`${s.event_name} ${s.session_name} is live. Click to follow it.`}
          className="flex shrink-0 items-center gap-1 border border-pit px-1.5 text-[11px] font-semibold text-pit"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-pit" />
          LIVE {s.code} {s.event_name.replace(/ Grand Prix$/, ' GP')}
        </button>
      ))}
    </>
  );
}
