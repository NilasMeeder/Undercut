import { useSeasonEvents } from '@/api/queries';
import { cn } from '@/lib/utils';
import { useSelection } from '@/store/selection';

const FIRST_SEASON = 2018;
const seasons = Array.from(
  { length: new Date().getFullYear() - FIRST_SEASON + 1 },
  (_, i) => new Date().getFullYear() - i
);

const selectClass =
  'h-8 rounded-md border border-input bg-card px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function SessionPicker() {
  const { year, round, session, setYear, setRound, setSession } = useSelection();
  const { data, isLoading, error } = useSeasonEvents(year);
  const event = data?.events.find((e) => e.round === round);

  return (
    <div className="flex flex-wrap items-center gap-2">
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
        className={cn(selectClass, 'min-w-56')}
        value={round ?? ''}
        disabled={!data}
        onChange={(e) => setRound(Number(e.target.value))}
      >
        <option value="" disabled>
          {isLoading ? 'Loading events…' : error ? 'Failed to load events' : 'Select event'}
        </option>
        {data?.events.map((e) => (
          <option key={e.round} value={e.round}>
            R{e.round} · {e.name}
          </option>
        ))}
      </select>

      {event ? (
        <div className="flex gap-1" role="group" aria-label="Session">
          {event.sessions.map((s) => (
            <button
              key={s.code}
              type="button"
              title={s.name}
              onClick={() => setSession(s.code)}
              className={cn(
                'h-8 rounded-md px-2.5 font-mono text-xs font-semibold transition-colors',
                session === s.code
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-accent'
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
