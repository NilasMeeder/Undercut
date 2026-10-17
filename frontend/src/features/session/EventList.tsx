import { useSeasonEvents } from '@/api/queries';
import { cn } from '@/lib/utils';
import { useSelection } from '@/store/selection';

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

export function EventList() {
  const { year, round, setRound } = useSelection();
  const { data, isLoading, error } = useSeasonEvents(year);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading {year} calendar…</p>;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th className="py-2 pr-4 font-medium">Rnd</th>
          <th className="py-2 pr-4 font-medium">Event</th>
          <th className="py-2 pr-4 font-medium">Location</th>
          <th className="py-2 pr-4 font-medium">Date</th>
          <th className="py-2 font-medium">Sessions</th>
        </tr>
      </thead>
      <tbody>
        {data?.events.map((e) => (
          <tr
            key={e.round}
            onClick={() => setRound(e.round)}
            className={cn(
              'cursor-pointer border-t border-border hover:bg-accent/50',
              e.round === round && 'bg-accent'
            )}
          >
            <td className="py-1.5 pr-4 font-mono text-muted-foreground">{e.round}</td>
            <td className="py-1.5 pr-4 font-medium">{e.name}</td>
            <td className="py-1.5 pr-4 text-muted-foreground">
              {e.location}, {e.country}
            </td>
            <td className="py-1.5 pr-4 font-mono text-muted-foreground">
              {dateFormat.format(new Date(e.date))}
            </td>
            <td className="py-1.5 font-mono text-xs text-muted-foreground">
              {e.sessions.map((s) => s.code).join(' · ')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
