import { useMemo, useRef, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import type { DriverInfo } from '@/api/client';
import {
  useLaps,
  useOvertake,
  usePasses,
  useRaceHistory,
  useReport,
  useSessionDetail,
  useStewarding,
  useStraightMode,
  useTimeline,
} from '@/api/queries';
import { HeaderMenu, headerButton } from '@/dashboard/HeaderMenu';
import { Segment } from '@/dashboard/PanelMenus';
import { ALERT_KINDS, PER_CAR, buildAlerts, type Alert, type AlertTone } from '@/lib/alerts';
import { momentLabel } from '@/lib/replay';
import { cn } from '@/lib/utils';
import { useClockPassing } from '@/features/clock/useClockPassing';
import { useAlerts } from '@/store/alerts';
import { useGroups } from '@/store/groups';
import { useSessionKey } from '@/store/selection';

/** How long a toast stays (ms of wall time), and how many at once. */
const LIFETIME = 9000;
const MAX_SHOWN = 4;

const TONE_BAR: Record<AlertTone, string> = {
  best: 'bg-best',
  pit: 'bg-pit',
  slow: 'bg-slow',
  ers: 'bg-ers',
  pb: 'bg-pb',
  plain: 'bg-faint',
};
const TONE_TEXT: Record<AlertTone, string> = {
  best: 'text-best',
  pit: 'text-pit',
  slow: 'text-slow',
  ers: 'text-ers',
  pb: 'text-pb',
  plain: 'text-text',
};

type Toast = { alert: Alert; id: number };

/**
 * Alerts on the pitwall as toasts at the bottom right: each event once, when the session clock
 * passes it (playing, or live). A seek or a jump of the clock alerts nothing: what lies behind the
 * new time counts as seen.
 */
export function AlertToasts() {
  const session = useSessionKey();
  const race = session?.session === 'R' || session?.session === 'S';
  const practice = session?.session.startsWith('FP') ?? false;
  const { on, kinds, allCars } = useAlerts();
  const laps = useLaps().data;
  const history = useRaceHistory().data;
  const timeline = useTimeline().data;
  const drivers = useSessionDetail().data?.drivers;
  const stewarding = useStewarding(on && (kinds.stewards || kinds.deleted)).data;
  const passes = usePasses(on && race && kinds.pass).data;
  const lines = useStraightMode(on && race && kinds.ot && (session?.year ?? 0) >= 2026).data;
  const overtake = useOvertake(on && race && kinds.ot && lines?.overtake != null).data;
  const report = useReport(on && (race || practice) && kinds.pace).data;
  const groupLaps = useGroups((s) => s.laps);

  const alerts = useMemo(() => {
    if (!on) return [];
    const watched = new Set(Object.values(groupLaps).flatMap((l) => l.map((x) => x.driver)));
    return buildAlerts({
      race,
      laps,
      history,
      stewarding,
      timeline,
      passes,
      overtake,
      straightMode: lines,
      report,
    }).filter(
      (a) =>
        kinds[a.kind] && (!PER_CAR.has(a.kind) || allCars || a.drivers.some((d) => watched.has(d)))
    );
  }, [
    on,
    race,
    laps,
    history,
    stewarding,
    timeline,
    passes,
    overtake,
    lines,
    report,
    kinds,
    allCars,
    groupLaps,
  ]);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  // A new session or other settings: everything up to the clock counts as seen.
  const settings = `${session?.year}/${session?.round}/${session?.session}/${on}/${allCars}/${JSON.stringify(kinds)}`;
  useClockPassing(
    alerts,
    settings,
    (fresh) => {
      const added = fresh.map((alert) => ({ alert, id: nextId.current++ }));
      setToasts((shown) => [...added.reverse(), ...shown].slice(0, MAX_SHOWN));
      for (const toast of added)
        setTimeout(() => setToasts((shown) => shown.filter((s) => s.id !== toast.id)), LIFETIME);
    },
    () => setToasts([])
  );

  if (!on || toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-9 right-2 z-40 flex w-80 flex-col gap-1"
      aria-live="polite"
    >
      {toasts.map(({ alert, id }) => (
        <AlertToast
          key={id}
          alert={alert}
          drivers={drivers}
          when={momentLabel(alert.time, timeline, race)}
          onClose={() => setToasts((shown) => shown.filter((s) => s.id !== id))}
        />
      ))}
    </div>
  );
}

function AlertToast({
  alert,
  drivers,
  when,
  onClose,
}: {
  alert: Alert;
  drivers: DriverInfo[] | undefined;
  when: string;
  onClose: () => void;
}) {
  const color = (code: string) => drivers?.find((d) => d.code === code)?.color;
  return (
    <button
      type="button"
      onClick={onClose}
      title="Click to dismiss"
      className="pointer-events-auto flex border border-line-strong bg-header text-left text-[11px]"
    >
      <span className={cn('w-[3px] shrink-0', TONE_BAR[alert.tone])} />
      <span className="min-w-0 flex-1 px-2 py-1">
        <span className="flex items-baseline gap-2">
          <span className={cn('text-[10px] font-semibold tracking-wider', TONE_TEXT[alert.tone])}>
            {alert.title}
          </span>
          <span className="ml-auto text-[10px] tabular-nums text-faint">{when}</span>
        </span>
        <span className="flex items-baseline gap-1.5">
          {alert.drivers.slice(0, 1).map((d) => (
            <span key={d} className="flex items-center gap-1 font-semibold text-text">
              <span className="h-2.5 w-[3px]" style={{ background: color(d) }} />
              {d}
            </span>
          ))}
          <span className="truncate text-dim">
            {alert.kind === 'stewards' && alert.drivers.length > 1
              ? `${alert.drivers.slice(1).join(' ')} · ${alert.text}`
              : alert.text}
          </span>
        </span>
      </span>
    </button>
  );
}

/** The bell in the top bar (Pitwall): alerts on or off, which kinds, which cars. */
export function AlertsMenu() {
  const { on, kinds, allCars, setOn, setKind, setAllCars } = useAlerts();
  return (
    <HeaderMenu
      title={on ? 'Alerts on the board' : 'Alerts off'}
      width="w-80"
      buttonClassName={cn(headerButton, !on && 'text-faint')}
      icon={on ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
    >
      {() => (
        <div className="flex flex-col gap-1 p-2 text-[11px]">
          <Check label="Alerts on the board" checked={on} onChange={setOn} strong />
          <div className={cn('flex flex-col gap-1', !on && 'opacity-40')}>
            {ALERT_KINDS.map((k) => (
              <Check
                key={k.id}
                label={k.label}
                checked={kinds[k.id]}
                onChange={(v) => setKind(k.id, v)}
              />
            ))}
            <div className="mt-1 border-t border-line pt-1.5">
              <Check
                label="Deleted laps, gaps, overtake mode and passes for every car"
                checked={allCars}
                onChange={setAllCars}
              />
              <p className="mt-1 text-[10px] text-faint">
                Off: only for the drivers in the link groups (the laps in the top bar).
              </p>
            </div>
          </div>
        </div>
      )}
    </HeaderMenu>
  );
}

/** A row like the panel settings: the label, and On | Off. */
function Check({
  label,
  checked,
  onChange,
  strong,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('flex-1', strong ? 'font-semibold text-text' : 'text-dim')}>{label}</span>
      <div className="flex shrink-0">
        <Segment active={checked} onClick={() => onChange(true)}>
          On
        </Segment>
        <Segment active={!checked} onClick={() => onChange(false)}>
          Off
        </Segment>
      </div>
    </div>
  );
}
