import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EventList } from '@/features/session/EventList';
import { SessionPicker } from '@/features/session/SessionPicker';
import { useSelection } from '@/store/selection';

export default function App() {
  const year = useSelection((s) => s.year);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-6 w-6" />
          <span className="text-sm font-semibold tracking-wide">Pitwall</span>
        </div>
        <SessionPicker />
      </header>
      <main className="flex-1 p-4">
        <Card>
          <CardHeader className="p-4">
            <CardTitle className="text-base">{year} calendar</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <EventList />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
