import { useSeasonEvents } from '@/api/queries';
import { cn } from '@/lib/utils';
import { useSelection } from '@/store/selection';

const FIRST_SEASON = 2018;
const thisYear = new Date().getFullYear();
const seasons = Array.from({ length: thisYear - FIRST_SEASON + 1 }, (_, i) => thisYear - i);

const selectClass =
  'h-6 border border-line-strong bg-panel px-1 text-[11px] text-text focus-visible:outline-none focus-visible:border-dim';

export function SessionPicker() {
  const { year, round, session, setYear, setRound, setSession } = useSelection();
  const { data, isLoading, error } = useSeasonEvents(year);
  const event = data?.events.find((e) => e.round === round);

  return (
    <div className="flex items-center gap-1">
      <select
        aria-label="Season"
        className={selectClass}
        value={year}
        onChange={(e) => setYear(Number(e.target.value))}
      >
        {seasons.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <select
        aria-label="Event"
        className={cn(selectClass, 'w-52')}
        value={round ?? ''}
        disabled={!data}
        onChange={(e) => setRound(Number(e.target.value))}
      >
        <option value="" disabled>
          {isLoading ? 'Loading…' : error ? 'Failed to load events' : 'Event'}
        </option>
        {data?.events.map((e) => (
          <option key={e.round} value={e.round}>
            {String(e.round).padStart(2, '0')} {e.name}
          </option>
        ))}
      </select>
      {event ? (
        <div className="flex" role="group" aria-label="Session">
          {event.sessions.map((s) => (
            <button
              key={s.code}
              type="button"
              title={s.name}
              onClick={() => setSession(s.code)}
              className={cn(
                'h-6 border border-l-0 border-line-strong px-2 text-[11px] font-semibold first:border-l',
                session === s.code ? 'bg-text text-bg' : 'bg-panel text-dim hover:text-text'
              )}
            >
              {s.code}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
