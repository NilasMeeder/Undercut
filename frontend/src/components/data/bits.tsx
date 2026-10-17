import type { DriverInfo } from '@/api/client';
import { TYRE_COLORS } from '@/lib/colors';
import { GROUP_COLORS, type GroupId } from '@/store/groups';

export function PanelMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-4 text-center text-[11px] text-faint">
      {children}
    </div>
  );
}

/** Empty state of a chart panel: says which link group needs laps, since that is easy to miss. */
export function NoLapsMessage({ group }: { group: GroupId }) {
  return (
    <PanelMessage>
      <span
        className="mr-1.5 inline-block h-2.5 w-2.5 align-[-1px]"
        style={{ background: GROUP_COLORS[group] }}
      />
      No laps in the {group} group. Click rows in a Laps panel set to {group}.
    </PanelMessage>
  );
}

const TYRE_LETTER: Record<string, string> = {
  SOFT: 'S',
  MEDIUM: 'M',
  HARD: 'H',
  INTERMEDIATE: 'I',
  WET: 'W',
};

export function TyreBadge({ compound }: { compound: string | null }) {
  if (!compound || !(compound in TYRE_LETTER)) return <span className="text-faint">–</span>;
  return (
    <span
      title={compound}
      className="inline-flex h-[14px] w-[14px] items-center justify-center rounded-full border-[1.5px] text-[8px] font-bold leading-none"
      style={{ borderColor: TYRE_COLORS[compound], color: TYRE_COLORS[compound] }}
    >
      {TYRE_LETTER[compound]}
    </span>
  );
}

/** A short line sample in a lap's colour and dash, so identity is never colour alone. */
export function LineSwatch({ color, dash }: { color: string; dash?: number[] }) {
  return (
    <svg width="16" height="6" className="shrink-0" aria-hidden>
      <line
        x1="0"
        y1="3"
        x2="16"
        y2="3"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={dash?.join(' ')}
      />
    </svg>
  );
}

/** Driver code with a team-colour bar, as the first cell of a timing-table row. */
export function DriverCell({ code, drivers }: { code: string; drivers: DriverInfo[] }) {
  const color = drivers.find((d) => d.code === code)?.color;
  return (
    <td className="px-1.5 py-[1px] text-left font-semibold">
      <span
        className="mr-1.5 inline-block h-2.5 w-[3px] align-[-1px]"
        style={{ background: color }}
      />
      {code}
    </td>
  );
}
