import { usePitStops, useSessionDetail } from '@/api/queries';
import { DriverCell, PanelMessage } from '@/components/data/bits';
import { th, td } from '@/lib/table';
import { cn } from '@/lib/utils';
import { useClockTime } from '@/store/clock';
import { useSelection } from '@/store/selection';
import type { WidgetProps } from '../types';
import type { PitStopsConfig } from './widget';

const SLOW = 4;

export function PitStopsWidget({ config, setConfig }: WidgetProps<PitStopsConfig>) {
  const code = useSelection((s) => s.session);
  const race = code === 'R' || code === 'S';
  const stops = usePitStops(race);
  const detail = useSessionDetail();
  const t = useClockTime(500);

  if (!race) return <PanelMessage>Pit stops are for races.</PanelMessage>;
  if (stops.error) return <PanelMessage>{stops.error.message}</PanelMessage>;
  if (!stops.data || !detail.data) return <PanelMessage>Measuring the stops…</PanelMessage>;

  // Out of the pit lane by the clock.
  const done = stops.data.filter((s) => s.t + s.lane <= t);
  const fastest = Math.min(...done.map((s) => s.stationary ?? Infinity));
  const list =
    config.order === 'fastest'
      ? [...done].sort((a, b) => (a.stationary ?? Infinity) - (b.stationary ?? Infinity))
      : [...done].reverse();
  const measured = done.some((s) => s.source === 'telemetry');

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-1.5 py-0.5 text-[10px] text-faint">
        {(['fastest', 'time'] as const).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setConfig({ order: o })}
            className={
              config.order === o ? 'font-semibold text-text' : 'font-semibold hover:text-dim'
            }
          >
            {o === 'fastest' ? 'FASTEST' : 'LATEST'}
          </button>
        ))}
        <span className="ml-auto truncate">
          {done.length === 0
            ? ''
            : measured
              ? '≈ measured in the telemetry'
              : 'stood still: F1’s time'}
        </span>
      </div>
      {done.length === 0 ? (
        <PanelMessage>No stops yet.</PanelMessage>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full whitespace-nowrap text-[11px] tabular-nums">
            <thead>
              <tr>
                <th className={cn(th, 'text-left')}>Drv</th>
                <th className={cn(th, 'text-right')}>Lap</th>
                <th className={cn(th, 'text-right')} title="Seconds stood still">
                  Stood
                </th>
                <th className={cn(th, 'text-right')} title="Pit entry to exit">
                  Lane
                </th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={`${s.driver}-${s.lap}`} className="hover:bg-raised">
                  <DriverCell code={s.driver} drivers={detail.data.drivers} />
                  <td className={cn(td, 'text-dim')}>{s.lap}</td>
                  <td
                    className={cn(
                      td,
                      'font-semibold',
                      s.stationary === fastest
                        ? 'text-best'
                        : s.stationary != null && s.stationary > SLOW
                          ? 'text-slow'
                          : 'text-text'
                    )}
                    title={s.source === 'telemetry' ? 'Measured in the telemetry' : undefined}
                  >
                    {s.stationary == null
                      ? '—'
                      : `${s.source === 'telemetry' ? '≈' : ''}${s.stationary.toFixed(1)}`}
                  </td>
                  <td className={cn(td, 'text-dim')}>{s.lane.toFixed(1)}</td>
                  <td className="px-1.5 py-[1px] text-left text-[10px] text-faint">
                    {s.status === 'sc' ? 'SC' : s.status.startsWith('vsc') ? 'VSC' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
