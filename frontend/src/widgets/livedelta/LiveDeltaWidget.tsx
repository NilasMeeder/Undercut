import { useMemo, useRef, type ReactNode } from 'react';
import type { TowerRow } from '@/api/client';
import { useReplayPositions, useSessionDetail, useTimingState } from '@/api/queries';
import { NoLapsMessage, PanelMessage } from '@/components/data/bits';
import { COLORS } from '@/lib/colors';
import { formatGap } from '@/lib/format';
import { describeCheck } from '@/lib/overtake';
import { timeGap } from '@/lib/replay';
import { useClockTime } from '@/store/clock';
import { useGroupLaps } from '@/store/groups';
import { useClockDraw, useElementSize } from '../hooks';
import { progressAt, useLiveLap } from '../livelap/useLiveLap';
import type { WidgetProps } from '../types';
import { useOvertakeMode } from '../useOvertakeMode';
import { arrange, type Spot } from './arrange';
import type { LiveDeltaConfig } from './widget';

/** Shown where there is no number. */
const NONE = '—';

type Gap = {
  label: string;
  text: string;
  real: boolean;
  /** The other car, for the gap on track (races); null without one or when lapped. */
  driver: string | null;
};

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
      ? { label: 'P1', text: NONE, real: false, driver: null }
      : {
          label: `▲ ${rows[i - 1].driver}`,
          text: aheadText ?? NONE,
          real: aheadText != null,
          driver: row.interval_laps > 0 ? null : rows[i - 1].driver,
        };
  const behind: Gap = next
    ? {
        label: `▼ ${next.driver}`,
        text: behindText ?? NONE,
        real: behindText != null,
        driver: next.interval_laps > 0 || next.status === 'retired' ? null : next.driver,
      }
    : { label: 'LAST', text: NONE, real: false, driver: null };
  return { position: row.position, ahead, behind };
}

function GapRow({
  gap,
  spots,
  title,
  side,
  drawn,
  overtake,
}: {
  gap: Gap | undefined;
  spots: { label: Spot; gap: Spot };
  title: string;
  side: 'ahead' | 'behind';
  /** The number is written every frame (races, from the position track). */
  drawn: boolean;
  overtake: boolean;
}) {
  const { label, gap: number } = spots;
  return (
    <g>
      <title>{title}</title>
      <text
        x={label.x}
        y={label.y}
        fontSize={label.size}
        textAnchor={label.anchor}
        fill={gap?.real ? COLORS.textDim : COLORS.textFaint}
      >
        {gap?.label ?? ''}
        {overtake ? (
          <tspan
            dx={label.size * 0.45}
            fontSize={label.size * 0.8}
            fontWeight={600}
            fill={COLORS.ers}
          >
            OT
          </tspan>
        ) : null}
      </text>
      <text
        key={drawn ? 'drawn' : 'tower'}
        data-gap={drawn ? side : undefined}
        x={number.x}
        y={number.y}
        fontSize={number.size}
        textAnchor={number.anchor}
        fill={gap?.real ? COLORS.text : COLORS.textFaint}
      >
        {drawn ? null : (gap?.text ?? NONE)}
      </text>
    </g>
  );
}

function gapTitle(race: boolean, side: 'ahead' | 'behind'): string {
  return race
    ? side === 'ahead'
      ? 'Gap to the car ahead on track: seconds since it was where this car is now (from the positions; the tower’s when lapped or in the pits)'
      : 'Gap to the car behind on track: seconds since this car was where it is now'
    : `Gap to the car ${side} in the tower (best laps)`;
}

/**
 * The live delta of the group's driver as one big number (the same as Live lap), with the gap to
 * the car ahead and the car behind. The SVG is the panel's size in px and `arrange` lays it out
 * for the panel's shape, so it fills any panel.
 */
export function LiveDeltaWidget({ group, config }: WidgetProps<LiveDeltaConfig>) {
  const boxRef = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(boxRef);
  const spots = useMemo(() => arrange(width, height), [width, height]);
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

  // Races: both gaps on track every frame (the tower's only change at the timing lines).
  const race = timing.data?.kind === 'race';
  const { track } = useReplayPositions(race);
  const svgRef = useRef<SVGSVGElement>(null);
  const onTrack = race && track != null && track.cars.some((c) => c.driver === driver);
  const drawGaps = useMemo(() => {
    if (!onTrack || !track || !driver || !around) return null;
    const index = (code: string | null) =>
      code == null ? -1 : track.cars.findIndex((c) => c.driver === code);
    const me = index(driver);
    const [ahead, behind] = [index(around.ahead.driver), index(around.behind.driver)];
    const write = (side: 'ahead' | 'behind', gap: number | null) => {
      const el = svgRef.current?.querySelector(`[data-gap=${side}]`);
      if (el) el.textContent = gap == null ? around[side].text : formatGap(gap).slice(1);
    };
    return (now: number) => {
      write('ahead', ahead < 0 ? null : timeGap(track, ahead, me, now));
      write('behind', behind < 0 ? null : timeGap(track, me, behind, now));
    };
  }, [onTrack, track, driver, around]);
  useClockDraw(drawGaps);

  const deltaRef = useRef<SVGTextElement>(null);
  const deltaSize = spots.delta.size;
  const draw = useMemo(() => {
    if (!data) return null;
    return (now: number) => {
      const el = deltaRef.current;
      if (!el) return;
      const { gap } = progressAt(data, now);
      const text = gap == null ? NONE : formatGap(gap);
      el.textContent = text;
      // Sized for −0.125: −12.345 shrinks to the same width.
      el.setAttribute('font-size', String(deltaSize * Math.min(1, 6 / text.length)));
      el.setAttribute(
        'fill',
        gap == null ? COLORS.textFaint : Math.round(gap * 1000) < 0 ? COLORS.pb : COLORS.slow
      );
    };
  }, [data, deltaSize]);
  useClockDraw(draw);

  // The box always renders: useElementSize measures it once, on mount.
  let content: ReactNode;
  if (!driver) content = <NoLapsMessage group={group} />;
  else if (progress.error && !data) content = <PanelMessage>{progress.error.message}</PanelMessage>;
  else if (width > 0 && height > 0) {
    const sub = [
      around ? `P${around.position}` : null,
      data ? (data.out_lap ? 'OUT LAP' : `L${data.lap}`) : null,
    ]
      .filter(Boolean)
      .join('  ');
    const reference = data?.reference ? `vs L${data.reference.lap}` : '';
    const { driver: name, sub: subSpot, reference: referenceSpot, delta } = spots;
    content = (
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="block"
        style={{ fontVariantNumeric: 'tabular-nums' }}
        role="img"
        aria-label={`Live delta of ${driver}`}
      >
        {spots.ahead ? (
          <GapRow
            gap={around?.ahead}
            spots={spots.ahead}
            title={`${gapTitle(race, 'ahead')}${overtake ? `\n${describeCheck(overtake)}` : ''}`}
            side="ahead"
            drawn={onTrack && around != null}
            overtake={overtake != null}
          />
        ) : null}
        {name ? (
          <>
            <rect
              x={name.x}
              y={name.y - name.size * 0.78}
              width={Math.max(2, name.size * 0.14)}
              height={name.size * 0.8}
              fill={color}
            />
            <text
              x={name.x + name.size * 0.4}
              y={name.y}
              fontSize={name.size}
              fontWeight={600}
              fill={COLORS.text}
            >
              {driver}
              {spots.kind === 'row' && reference ? (
                <tspan
                  dx={name.size * 0.5}
                  fontSize={name.size * 0.7}
                  fontWeight={400}
                  fill={COLORS.textFaint}
                >
                  {reference}
                </tspan>
              ) : null}
            </text>
          </>
        ) : null}
        {subSpot ? (
          <text
            x={spots.kind === 'row' ? subSpot.x + subSpot.size * 4.5 : subSpot.x}
            y={subSpot.y}
            fontSize={subSpot.size}
            textAnchor={subSpot.anchor}
            fill={COLORS.textDim}
          >
            {spots.kind === 'row' ? '' : sub}
          </text>
        ) : null}
        {referenceSpot ? (
          <text
            x={referenceSpot.x}
            y={referenceSpot.y}
            fontSize={referenceSpot.size}
            textAnchor={referenceSpot.anchor}
            fill={COLORS.textFaint}
          >
            {reference}
          </text>
        ) : null}
        <g>
          <title>Time behind the reference lap at the car's position</title>
          {/* Written every frame (useClockDraw), so React leaves its text and colour alone. */}
          <text
            key={data ? 'delta' : 'none'}
            ref={data ? deltaRef : undefined}
            x={delta.x}
            y={delta.y}
            fontSize={delta.size}
            fontWeight={600}
            textAnchor={delta.anchor}
            fill={data ? undefined : COLORS.textFaint}
          >
            {data ? null : NONE}
          </text>
        </g>
        {spots.behind ? (
          <GapRow
            gap={around?.behind}
            spots={spots.behind}
            title={gapTitle(race, 'behind')}
            side="behind"
            drawn={onTrack && around != null}
            overtake={false}
          />
        ) : null}
      </svg>
    );
  }
  return (
    <div ref={boxRef} className="h-full w-full overflow-hidden">
      {content}
    </div>
  );
}
