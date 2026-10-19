import { useMemo, useRef } from 'react';
import type { TowerRow } from '@/api/client';
import { useSessionDetail, useTimingState } from '@/api/queries';
import { NoLapsMessage, PanelMessage } from '@/components/data/bits';
import { COLORS } from '@/lib/colors';
import { formatGap } from '@/lib/format';
import { describeCheck } from '@/lib/overtake';
import { useClockTime } from '@/store/clock';
import { useGroupLaps } from '@/store/groups';
import { useClockDraw } from '../hooks';
import { progressAt, useLiveLap } from '../livelap/useLiveLap';
import type { WidgetProps } from '../types';
import { useOvertakeMode } from '../useOvertakeMode';
import type { LiveDeltaConfig } from './widget';

// One SVG scaled to fit the panel, so the numbers grow with it (like the Clock).
const W = 320;
const H = 160;
const RIGHT = W - 4;
/** Shown where there is no number. */
const NONE = '—';

type Gap = { label: string; text: string; real: boolean };

/** "+1 LAP" for a lapped car, else the seconds without a sign. */
function gapText(seconds: number | null, laps: number): string | null {
  if (laps > 0) return `+${laps} LAP${laps > 1 ? 'S' : ''}`;
  return seconds == null ? null : formatGap(seconds).slice(1);
}

/** The gap to the car ahead and the one behind in the tower: each car's interval to the car
 * ahead, so the car behind's own interval is the gap behind. */
function neighbours(rows: TowerRow[], driver: string) {
  const i = rows.findIndex((r) => r.driver === driver);
  if (i < 0) return null;
  const row = rows[i];
  const next = rows[i + 1];
  const aheadText = i > 0 ? gapText(row.interval, row.interval_laps) : null;
  const behindText =
    next && next.status !== 'retired' ? gapText(next.interval, next.interval_laps) : null;
  const ahead: Gap =
    i === 0
      ? { label: 'P1', text: NONE, real: false }
      : { label: `▲ ${rows[i - 1].driver}`, text: aheadText ?? NONE, real: aheadText != null };
  const behind: Gap = next
    ? { label: `▼ ${next.driver}`, text: behindText ?? NONE, real: behindText != null }
    : { label: 'LAST', text: NONE, real: false };
  return { position: row.position, ahead, behind };
}

/**
 * The live delta of the group's driver as one big number (the same as Live lap), with the gap to
 * the car ahead above it and the gap to the car behind under it.
 */
export function LiveDeltaWidget({ group, config }: WidgetProps<LiveDeltaConfig>) {
  const laps = useGroupLaps(group);
  const driver = laps[0]?.driver;
  const progress = useLiveLap(driver, config.reference);
  const data = progress.data;
  const timing = useTimingState();
  const detail = useSessionDetail();
  const color = detail.data?.drivers.find((d) => d.code === driver)?.color ?? COLORS.text;
  const rows = timing.data?.rows;
  const around = useMemo(() => (rows && driver ? neighbours(rows, driver) : null), [rows, driver]);

  // Overtake mode (2026 races): OT beside the car ahead while the driver has it.
  const overtakeAt = useOvertakeMode(timing.data?.kind === 'race');
  const t = useClockTime(500);
  const overtake = driver && overtakeAt ? overtakeAt(driver, t) : null;

  const deltaRef = useRef<SVGTextElement>(null);
  const draw = useMemo(() => {
    if (!data) return null;
    return (now: number) => {
      const el = deltaRef.current;
      if (!el) return;
      const { gap } = progressAt(data, now);
      const text = gap == null ? NONE : formatGap(gap);
      el.textContent = text;
      // −12.345 would run into the driver's name.
      el.setAttribute('font-size', text.length > 6 ? '50' : '64');
      el.setAttribute(
        'fill',
        gap == null ? COLORS.textFaint : Math.round(gap * 1000) < 0 ? COLORS.pb : COLORS.slow
      );
    };
  }, [data]);
  useClockDraw(draw);

  if (!driver) return <NoLapsMessage group={group} />;
  if (progress.error && !data) return <PanelMessage>{progress.error.message}</PanelMessage>;

  const sub = [
    around ? `P${around.position}` : null,
    data ? (data.out_lap ? 'OUT LAP' : `L${data.lap}`) : null,
  ]
    .filter(Boolean)
    .join('  ');
  const reference = data?.reference ? `vs L${data.reference.lap}` : '';
  const gapRow = (gap: Gap | undefined, y: number, title: string) => (
    <g>
      <title>{title}</title>
      <text x={4} y={y} fontSize={17} fill={gap?.real ? COLORS.textDim : COLORS.textFaint}>
        {gap?.label ?? ''}
        {y < H / 2 && overtake ? (
          <tspan dx={8} fontSize={13} fontWeight={600} fill={COLORS.ers}>
            OT
          </tspan>
        ) : null}
      </text>
      <text
        x={RIGHT}
        y={y}
        fontSize={30}
        textAnchor="end"
        fill={gap?.real ? COLORS.text : COLORS.textFaint}
      >
        {gap?.text ?? NONE}
      </text>
    </g>
  );

  return (
    <div className="flex h-full items-center justify-center p-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        style={{ fontVariantNumeric: 'tabular-nums' }}
        role="img"
        aria-label={`Live delta of ${driver}`}
      >
        {gapRow(
          around?.ahead,
          30,
          `Gap to the car ahead in the tower${overtake ? `\n${describeCheck(overtake)}` : ''}`
        )}
        <rect x={4} y={66} width={3} height={22} fill={color} />
        <text x={12} y={85} fontSize={22} fontWeight={600} fill={COLORS.text}>
          {driver}
        </text>
        <text x={4} y={104} fontSize={12} fill={COLORS.textDim}>
          {sub}
        </text>
        <text x={4} y={119} fontSize={11} fill={COLORS.textFaint}>
          {reference}
        </text>
        <g>
          <title>Time behind the reference lap at the car's position</title>
          {/* Written every frame (useClockDraw), so React leaves its text and colour alone. */}
          <text
            key={data ? 'delta' : 'none'}
            ref={data ? deltaRef : undefined}
            x={RIGHT}
            y={110}
            fontSize={64}
            fontWeight={600}
            textAnchor="end"
            fill={data ? undefined : COLORS.textFaint}
          >
            {data ? null : NONE}
          </text>
        </g>
        {gapRow(around?.behind, 152, 'Gap to the car behind in the tower')}
      </svg>
    </div>
  );
}
