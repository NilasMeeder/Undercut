import type { ForecastRow } from '@/api/client';
import { useForecast } from '@/api/queries';
import { DriverCell, PanelMessage, TyreBadge } from '@/components/data/bits';
import { formatGap } from '@/lib/format';
import { td, th } from '@/lib/table';
import { cn } from '@/lib/utils';
import type { WidgetProps } from '../types';
import { useStrategyClock } from '../useStrategy';
import type { ForecastConfig } from './widget';

const PASSES_SHOWN = 3;

/** "LEC L39, ALB (stop)": a pass at the other car's assumed stop has no real lap. */
function passList(passes: ForecastRow['passes'], stops: Map<string, number | null>): string {
  return passes
    .map((p) => {
      const stop = stops.get(p.driver);
      return stop != null && p.lap >= stop && p.lap <= stop + 1
        ? `${p.driver} (stop)`
        : `${p.driver} L${p.lap}`;
    })
    .join(', ');
}

export function ForecastWidget({ config }: WidgetProps<ForecastConfig>) {
  const { history, drivers, until, error } = useStrategyClock();
  const race = history?.kind === 'race';
  const forecast = useForecast(until, config.fuel, race);

  if (error) return <PanelMessage>{error.message}</PanelMessage>;
  if (!history || !drivers) return <PanelMessage>Loading laps…</PanelMessage>;
  if (!race) return <PanelMessage>The forecast is for races and sprints.</PanelMessage>;
  if (forecast.error && !forecast.data)
    return <PanelMessage>{forecast.error.message}</PanelMessage>;
  const f = forecast.data;
  if (!f) return <PanelMessage>Calculating…</PanelMessage>;
  if (f.rows.length === 0) return <PanelMessage>No laps yet.</PanelMessage>;
  const stops = new Map(f.rows.map((r) => [r.driver, r.stop_lap]));

  return (
    <div className="h-full overflow-auto text-[11px] tabular-nums">
      <div className="flex items-center gap-3 border-b border-line px-1.5 py-0.5 text-dim">
        <span>
          At lap {f.lap}/{f.total_laps}
        </span>
        <span className="ml-auto text-faint">pit loss {f.pit_loss.toFixed(1)} s</span>
      </div>
      <table className="w-full whitespace-nowrap">
        <thead>
          <tr>
            <th className={cn(th, 'text-right')}>P</th>
            <th className={cn(th, 'text-right')} title="Places against now">
              ±
            </th>
            <th className={cn(th, 'text-left')}>Driver</th>
            <th className={cn(th, 'text-right')} title="Predicted gap to the winner at the flag">
              Gap
            </th>
            <th
              className={cn(th, 'text-left')}
              title="The stop still owed (one dry compound so far), assumed halfway to the flag"
            >
              Stop
            </th>
            <th className={cn(th, 'text-left')}>Passes</th>
          </tr>
        </thead>
        <tbody>
          {f.rows.map((r) => {
            const moved = r.now - r.position;
            return (
              <tr key={r.driver}>
                <td className={td}>{r.position}</td>
                <td
                  className={cn(td, moved > 0 ? 'text-pb' : moved < 0 ? 'text-slow' : 'text-faint')}
                >
                  {moved > 0 ? `▲${moved}` : moved < 0 ? `▼${-moved}` : '='}
                </td>
                <DriverCell code={r.driver} drivers={drivers} />
                <td className={td}>
                  {r.laps_down > 0
                    ? `+${r.laps_down} LAP${r.laps_down > 1 ? 'S' : ''}`
                    : r.gap == null
                      ? '–'
                      : r.position === 1
                        ? ''
                        : formatGap(r.gap)}
                </td>
                <td
                  className="px-1.5 py-[1px]"
                  title={r.stop_lap ? `Assumed at the end of lap ${r.stop_lap}` : undefined}
                >
                  {r.stop_lap ? (
                    <span className="inline-flex items-center gap-1 text-dim">
                      +{f.pit_loss.toFixed(0)} s <span className="text-faint">→</span>
                      <TyreBadge compound={r.stop_compound} />
                    </span>
                  ) : null}
                </td>
                <td className="px-1.5 py-[1px] text-dim" title={passList(r.passes, stops)}>
                  {passList(r.passes.slice(0, PASSES_SHOWN), stops)}
                  {r.passes.length > PASSES_SHOWN ? (
                    <span className="text-faint"> +{r.passes.length - PASSES_SHOWN}</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {f.notes.length > 0 ? (
        <ul className="space-y-0.5 border-t border-line px-1.5 py-1 text-[10px] text-faint">
          {f.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
