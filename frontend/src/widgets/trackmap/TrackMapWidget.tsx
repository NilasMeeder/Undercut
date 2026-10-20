import { useCallback, useEffect, useMemo, useRef } from 'react';
import type {
  Circuit,
  Comparison,
  DriverInfo,
  EnergyComparison,
  Pass,
  StraightMode,
  TrackSectors,
  TrackZones,
} from '@/api/client';
import {
  useCircuit,
  useEnergy,
  useOvertake,
  usePasses,
  useReplayPositions,
  useSectors,
  useSessionDetail,
  useStraightMode,
  useZones,
  type PositionTrack,
} from '@/api/queries';
import { useDistanceMarks } from '@/api/markers';
import { isAuto } from '@/lib/autoMarkers';
import { PanelMessage } from '@/components/data/bits';
import { COLORS } from '@/lib/colors';
import type { DistanceMark } from '@/lib/markers';
import { describeCheck, hasOvertake, overtakeIndex, type OvertakeIndex } from '@/lib/overtake';
import { activeZones, describeZone, useLowGripAtClock } from '@/lib/straightMode';
import { carAt, ghostKinds, pitGhost, type GhostKind } from '@/lib/replay';
import {
  cornerGear,
  levelOpacity,
  levelRuns,
  levels,
  speedRange,
  SPEED_BANDS,
  THROTTLE_LEVELS,
  type TrackChannel,
} from '@/lib/trackColour';
import type { LapStyle } from '@/lib/timing';
import { useClockTime } from '@/store/clock';
import { cursorBus, useZoom, useZoomKind } from '@/store/cursor';
import { useGroupLaps, type GroupId } from '@/store/groups';
import { useSelection } from '@/store/selection';
import { useClockDraw } from '../hooks';
import { useSectorFlags } from '../useSectorFlags';
import type { WidgetProps } from '../types';
import { useGroupComparison } from '../useGroupComparison';
import type { TrackMapConfig } from './widget';

type Point = [number, number];
type Along = { points: Point[]; distance: number[]; normals: Point[]; length: number };
type Stretch = { start: number; end: number };
type LapClips = { name: string; stretches: Stretch[]; superclips: Stretch[] };
/** The first compared lap's estimated deployment, for a zoomed stretch (2026). */
/** Overtake mode (2026): the FIA's lines, and in a race who has it at the clock. */
type Overtake = {
  data: StraightMode;
  index: OvertakeIndex;
};
type LapEnergy = {
  name: string;
  deploying: Stretch[];
  clipping: Stretch[];
  superclips: Stretch[];
};

const NO_GHOSTS: GhostKind[] = [];

/** Rotate by the circuit's official orientation; SVG y points down, so flip it. */
function project(x: number, y: number, rotation: number): Point {
  const a = (rotation * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), -(x * Math.sin(a) + y * Math.cos(a))];
}

function indexAt(distance: number[], d: number): number {
  let lo = 0;
  let hi = distance.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (distance[mid] < d) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function toPath(points: Point[]): string {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(0)},${y.toFixed(0)}`).join('');
}

/** Unit normals of a closed outline, pointing away from the middle of the circuit. */
function outwardNormals(points: Point[]): Point[] {
  const n = points.length;
  const normals = points.map((_, i): Point => {
    const [ax, ay] = points[(i - 2 + n) % n];
    const [bx, by] = points[(i + 2) % n];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    return [-(by - ay) / length, (bx - ax) / length];
  });
  const cx = points.reduce((sum, p) => sum + p[0], 0) / n;
  const cy = points.reduce((sum, p) => sum + p[1], 0) / n;
  const out = points.reduce(
    (sum, [x, y], i) => sum + normals[i][0] * (x - cx) + normals[i][1] * (y - cy),
    0
  );
  return out < 0 ? normals.map(([x, y]) => [-x, -y]) : normals;
}

/** A stretch of the lap drawn `offset` outside the track; one before the line (start < 0) or
 * past it wraps round. */
function offsetPath(along: Along, { start, end }: Stretch, offset: number): string {
  const { length } = along;
  const pieces: [number, number][] =
    start < 0
      ? [
          [start + length, length],
          [0, end],
        ]
      : end > length
        ? [
            [start, length],
            [0, end - length],
          ]
        : [[start, end]];
  return pieces
    .map(([a, b]) => {
      const from = indexAt(along.distance, a);
      const to = Math.max(indexAt(along.distance, b), from + 1);
      return toPath(
        along.points.slice(from, to + 1).map(([x, y], k): Point => {
          const [nx, ny] = along.normals[from + k] ?? [0, 0];
          return [x + nx * offset, y + ny * offset];
        })
      );
    })
    .join('');
}

export function TrackMapWidget({ group, config, setConfig }: WidgetProps<TrackMapConfig>) {
  const circuit = useCircuit();
  const { laps, data, styles, detail } = useGroupComparison(group, {
    miniSectors: config.miniSectors,
  });
  const zoom = useZoom(group);
  const zoomKind = useZoomKind(group);
  const fetchedZones = useZones(config.drs || config.straights).data;
  // One endpoint, by year: DRS zones until 2025, straights from 2026; each has its own toggle.
  const zones =
    fetchedZones &&
    (fetchedZones.kind === 'drs'
      ? config.drs
      : config.straights && fetchedZones.kind === 'straight')
      ? fetchedZones
      : undefined;
  const sectors = useSectors(config.sectors).data;
  const fetchedStraightMode = useStraightMode(config.straightMode || config.overtake).data;
  const straightMode = config.straightMode ? fetchedStraightMode : undefined;
  const lines = config.overtake && fetchedStraightMode?.overtake ? fetchedStraightMode : undefined;
  const checks = useOvertake(lines != null && config.cars === 'all').data;
  const overtake = useMemo<Overtake | undefined>(
    () => (lines ? { data: lines, index: overtakeIndex(checks) } : undefined),
    [lines, checks]
  );
  const race = useSelection((s) => s.session === 'R' || s.session === 'S');
  const passes = usePasses(config.passes && config.cars === 'all' && race).data;
  // Where each compared lap clipped (2026), on the first lap's scale like the comparison. A
  // disabled query still returns what another panel cached (Energy in 2025), hence `clips`.
  const clips = config.cars === 'laps' && zones?.kind === 'straight';
  // From 2026 a straight clicked in Energy shows on the map where the first lap deployed.
  const onZoom =
    config.cars === 'laps' && detail?.has_drs === false && zoom != null && zoomKind === 'energy';
  const fetched = useEnergy(laps, clips || onZoom).data;
  const energy = clips || onZoom ? fetched : undefined;
  const lapClips = useMemo(
    () =>
      clips
        ? energy?.laps.map((lap) => ({
            name: `${lap.driver} L${lap.lap}`,
            stretches: lap.straights.flatMap((s) => s?.clipping ?? []),
            superclips: lap.straights.flatMap((s) => (s?.superclip ? [s.superclip] : [])),
          }))
        : undefined,
    [clips, energy]
  );
  const first = laps[0];
  const lapEnergy = useMemo(
    () => (onZoom && first ? energyOf(energy, first.driver, first.lap) : undefined),
    [onZoom, energy, first]
  );

  if (circuit.error) return <PanelMessage>{circuit.error.message}</PanelMessage>;
  if (!circuit.data) return <PanelMessage>Loading circuit…</PanelMessage>;
  if (config.cars === 'all')
    return (
      <ReplayMap
        group={group}
        circuit={circuit.data}
        showCorners={config.corners}
        showMarks={config.markers}
        showGhosts={config.ghosts}
        zones={zones}
        straightMode={straightMode}
        overtake={overtake}
        passes={config.passes ? passes : undefined}
        sectors={config.sectors ? sectors : undefined}
      />
    );
  return (
    <TrackMap
      group={group}
      circuit={circuit.data}
      comparison={data}
      styles={styles}
      showCorners={config.corners}
      showMarks={config.markers}
      zones={zones}
      straightMode={straightMode}
      overtake={overtake}
      lapClips={lapClips}
      lapEnergy={lapEnergy}
      sectors={config.sectors ? sectors : undefined}
      colour={config.colour}
      onColour={(colour) => setConfig({ colour })}
    />
  );
}

/** The first lap's deploying and clipping stretches, once the energy query has that lap (it
 * keeps the previous selection's data while a new one loads). */
function energyOf(
  energy: EnergyComparison | undefined,
  driver: string,
  lap: number
): LapEnergy | undefined {
  const found = energy?.laps[0];
  if (!found || found.driver !== driver || found.lap !== lap) return undefined;
  const straights = found.straights.flatMap((s) => (s ? [s] : []));
  return {
    name: `${driver} L${lap}`,
    deploying: straights.flatMap((s) => s.deploying),
    clipping: straights.flatMap((s) => s.clipping),
    superclips: straights.flatMap((s) => (s.superclip ? [s.superclip] : [])),
  };
}

/** Within a stretch of a lap of `length`; one before the line (start < 0) or past it wraps. */
function within(stretches: Stretch[], d: number, length: number): boolean {
  return stretches.some(
    ({ start, end }) =>
      (d >= start && d <= end) ||
      (start < 0 && d >= start + length) ||
      (end > length && d <= end - length)
  );
}

/** The zoomed range of the reference lap as pieces: white, or (with the lap's energy) purple
 * where it deployed, faint amber where it clipped and amber where it lost speed (superclipping). */
function zoomPieces(
  distance: number[],
  points: Point[],
  [a, b]: [number, number],
  energy: LapEnergy | undefined
): { d: string; color: string }[] {
  const from = indexAt(distance, a);
  const to = indexAt(distance, b);
  if (!energy) return [{ d: toPath(points.slice(from, to + 1)), color: COLORS.text }];
  const length = distance[distance.length - 1];
  const colorAt = (i: number) =>
    within(energy.superclips, distance[i], length)
      ? COLORS.clip
      : within(energy.clipping, distance[i], length)
        ? COLORS.clipFaint
        : within(energy.deploying, distance[i], length)
          ? COLORS.ers
          : COLORS.text;
  const pieces: { d: string; color: string }[] = [];
  let start = from;
  for (let i = from + 1; i <= to + 1; i++) {
    if (i <= to && colorAt(i) === colorAt(start)) continue;
    pieces.push({ d: toPath(points.slice(start, Math.min(i, to) + 1)), color: colorAt(start) });
    start = i;
  }
  return pieces;
}

/** Every car at the session clock. */
function ReplayMap({
  group,
  circuit,
  showCorners,
  showMarks,
  showGhosts,
  zones,
  straightMode,
  overtake,
  passes,
  sectors,
}: {
  group: GroupId;
  circuit: Circuit;
  showCorners: boolean;
  showMarks: boolean;
  showGhosts: boolean;
  zones?: TrackZones;
  straightMode?: StraightMode;
  overtake?: Overtake;
  passes?: Pass[];
  sectors?: TrackSectors;
}) {
  const { status, track, error } = useReplayPositions();
  const detail = useSessionDetail();
  const ghosts = useMemo(
    () => (showGhosts ? ghostKinds(circuit) : NO_GHOSTS),
    [showGhosts, circuit]
  );
  const loading =
    error?.message ??
    (status?.state === 'error'
      ? `Positions failed: ${status.error}`
      : track
        ? null
        : `${status?.phase ?? 'Preparing positions'}… ${Math.round((status?.progress ?? 0) * 100)}%`);
  return (
    <TrackMap
      group={group}
      circuit={circuit}
      comparison={undefined}
      styles={[]}
      showCorners={showCorners}
      showMarks={showMarks}
      note={loading}
      cars={track && detail.data ? { track, drivers: detail.data.drivers } : undefined}
      ghosts={ghosts}
      zones={zones}
      straightMode={straightMode}
      overtake={overtake}
      passes={passes}
      sectors={sectors}
    />
  );
}

function TrackMap({
  group,
  circuit,
  comparison,
  styles,
  showCorners,
  showMarks,
  note,
  cars,
  ghosts = NO_GHOSTS,
  zones,
  straightMode,
  overtake,
  passes,
  lapClips,
  lapEnergy,
  sectors,
  colour = 'sectors',
  onColour,
}: {
  group: GroupId;
  circuit: Circuit;
  comparison: Comparison | undefined;
  styles: LapStyle[];
  showCorners: boolean;
  showMarks: boolean;
  note?: string | null;
  cars?: { track: PositionTrack; drivers: DriverInfo[] };
  /** Pit stop ghosts of the drivers selected in the group (with all cars). */
  ghosts?: GhostKind[];
  zones?: TrackZones;
  /** Straight-mode zones (2026), inside the track. */
  straightMode?: StraightMode;
  overtake?: Overtake;
  /** Races, with all cars: where cars got past each other, up to the clock. */
  passes?: Pass[];
  /** Per compared lap, where it clipped. */
  lapClips?: LapClips[];
  lapEnergy?: LapEnergy;
  sectors?: TrackSectors;
  /** With compared laps: mini-sectors, or the laps' telemetry along the track. */
  colour?: 'sectors' | TrackChannel;
  onColour?: (colour: 'sectors' | TrackChannel) => void;
}) {
  const zoom = useZoom(group);
  const ghostsRef = useRef<SVGGElement>(null);
  const dotsRef = useRef<SVGGElement>(null);
  const carsRef = useRef<SVGGElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  const selected = useGroupLaps(group);
  const highlight = useMemo(() => new Set(selected.map((l) => l.driver)), [selected]);
  const marks = useDistanceMarks(group);
  const lowGrip = useLowGripAtClock(straightMode);

  const geometry = useMemo(() => {
    const outline = circuit.track_x.map((x, i) => project(x, circuit.track_y[i], circuit.rotation));
    const xs = outline.map((p) => p[0]);
    const ys = outline.map((p) => p[1]);
    const [minX, maxX, minY, maxY] = [
      Math.min(...xs),
      Math.max(...xs),
      Math.min(...ys),
      Math.max(...ys),
    ];
    const size = Math.max(maxX - minX, maxY - minY);
    const pad = size * 0.08;
    // The outline from the start/finish line on, so lap distance only grows along it.
    const first = circuit.track_distance.indexOf(Math.min(...circuit.track_distance));
    const order = outline.map((_, i) => (first + i) % outline.length);
    const points = order.map((i) => outline[i]);
    const along: Along = {
      points,
      distance: order.map((i) => circuit.track_distance[i]),
      normals: outwardNormals(points),
      length: circuit.lap_length,
    };
    return {
      along,
      outline: toPath(outline) + 'Z',
      viewBox: `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`,
      unit: size / 100,
      corners: circuit.corners.map((c) => {
        const [x, y] = project(c.x, c.y, circuit.rotation);
        const [ox, oy] = project(
          Math.cos((c.angle * Math.PI) / 180) * size * 0.045,
          Math.sin((c.angle * Math.PI) / 180) * size * 0.045,
          circuit.rotation
        );
        return { label: c.label, x: x + ox, y: y + oy };
      }),
    };
  }, [circuit]);

  // Reference lap path on the comparison grid, split per mini-sector and coloured by the fastest lap.
  const lap = useMemo(() => {
    if (!comparison || comparison.laps.length === 0) return null;
    const ref = comparison.laps[0];
    const points = ref.x.map((x, i) => project(x, ref.y[i], circuit.rotation));
    const { boundaries, fastest } = comparison.mini_sectors;
    const sectors = fastest.map((winner, s) => {
      const from = indexAt(comparison.distance, boundaries[s]);
      const to = indexAt(comparison.distance, boundaries[s + 1]);
      return {
        d: toPath(points.slice(from, to + 1)),
        color: styles[winner]?.color ?? COLORS.textDim,
      };
    });
    const zoomed = zoom ? zoomPieces(comparison.distance, points, zoom, lapEnergy) : null;
    return {
      sectors,
      zoomed,
      laps: comparison.laps.map((l) => l.x.map((x, i) => project(x, l.y[i], circuit.rotation))),
    };
  }, [comparison, styles, circuit.rotation, zoom, lapEnergy]);

  const channel = colour !== 'sectors' && comparison && lap ? colour : null;
  const lanesFrom = zones && zones.zones.length > 0 ? LANE_STEP * (1 + (lapClips?.length ?? 0)) : 0;
  const telemetry = useMemo(
    () =>
      channel && comparison && lap
        ? channelLayer(channel, comparison, lap.laps[0], styles, geometry.along)
        : null,
    [channel, comparison, lap, styles, geometry.along]
  );

  // Cursor dots move imperatively: no React render per mouse move.
  useEffect(() => {
    if (!comparison || !lap) return;
    const update = () => {
      const g = dotsRef.current;
      if (!g) return;
      const distance = cursorBus.getCursor(group);
      const i = distance == null ? null : indexAt(comparison.distance, distance);
      Array.from(g.children).forEach((dot, n) => {
        const point = i == null ? null : lap.laps[n]?.[i];
        dot.setAttribute('visibility', point ? 'visible' : 'hidden');
        if (point) dot.setAttribute('transform', `translate(${point[0]},${point[1]})`);
      });
    };
    update();
    return cursorBus.subscribeCursor(group, update);
  }, [comparison, lap, group]);

  // Every car at the session clock, moved imperatively on each tick.
  const drawCars = useCallback(
    (t: number) => {
      const g = carsRef.current;
      if (!g || !cars) return;
      const now = cars.track.cars.map((_, i) => carAt(cars.track, i, t));
      Array.from(g.children).forEach((node, i) => {
        const at = now[i];
        node.setAttribute('visibility', at ? 'visible' : 'hidden');
        if (!at) return;
        if (overtake) {
          // <g><title/><circle ring/>…: the ring and its explanation.
          const check = hasOvertake(
            overtake.index,
            overtake.data.overtake_enabled,
            cars.track.cars[i].driver,
            t
          );
          const ring = node.children[1];
          ring.setAttribute('visibility', check ? 'inherit' : 'hidden');
          node.firstElementChild!.textContent = check ? describeCheck(check) : '';
        }
        const [x, y] = project(at.x, at.y, circuit.rotation);
        node.setAttribute('transform', `translate(${x.toFixed(0)},${y.toFixed(0)})`);
      });
      if (emptyRef.current) emptyRef.current.hidden = now.some((at) => at);
      // Pit ghosts: <g data-car data-loss> per selected driver and kind of stop.
      Array.from(ghostsRef.current?.children ?? []).forEach((node) => {
        const i = Number(node.getAttribute('data-car'));
        const ghost = pitGhost(cars.track, i, t, Number(node.getAttribute('data-loss')), now);
        node.setAttribute('visibility', ghost ? 'visible' : 'hidden');
        if (!ghost) return;
        const [x, y] = project(ghost.x, ghost.y, circuit.rotation);
        node.setAttribute('transform', `translate(${x.toFixed(0)},${y.toFixed(0)})`);
        node.lastElementChild!.textContent = `${node.getAttribute('data-label')} P${ghost.position}`;
      });
    },
    // Ghost nodes change with the selection: redraw them at once, also with the clock paused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cars, circuit.rotation, highlight, ghosts, overtake]
  );
  useClockDraw(cars ? drawCars : null);

  const u = geometry.unit;
  const markShapes = showMarks ? marks.map((m) => markShape(m, geometry.along, u)) : [];
  const color = (code: string) =>
    cars?.drivers.find((d) => d.code === code)?.color ?? COLORS.textDim;
  return (
    <div className="relative h-full">
      {note ? (
        <div className="absolute left-1.5 top-1 z-10 text-[10px] text-faint">{note}</div>
      ) : lap ? (
        <ColourLegend
          colour={colour}
          onColour={onColour}
          names={comparison!.laps.slice(0, MAX_CHANNEL_LAPS).map((l) => `${l.driver} L${l.lap}`)}
          range={telemetry?.range}
        />
      ) : null}
      {(zones && zones.zones.length > 0) || straightMode || overtake || (passes && cars) ? (
        <div className="absolute bottom-1 left-1.5 z-10 flex flex-col gap-0.5 text-[10px] text-faint">
          {passes && cars ? <PassesLegend passes={passes} /> : null}
          {overtake && cars ? <OvertakeLegend /> : null}
          {straightMode ? <StraightModeLegend data={straightMode} lowGrip={lowGrip} /> : null}
          {zones && zones.zones.length > 0 ? <ZoneLegend zones={zones} /> : null}
        </div>
      ) : null}
      {lap?.zoomed && lapEnergy ? <EnergyLegend name={lapEnergy.name} /> : null}
      {cars ? (
        <div ref={emptyRef} hidden className="absolute left-1.5 top-1 z-10 text-[10px] text-faint">
          No cars on track at the session clock
        </div>
      ) : null}
      <svg viewBox={geometry.viewBox} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        <path
          d={geometry.outline}
          fill="none"
          stroke={COLORS.lineStrong}
          strokeWidth={u * 2.2}
          strokeLinejoin="round"
        />
        {zones ? (
          <ZoneLayer along={geometry.along} zones={zones} lapClips={lapClips} unit={u} />
        ) : null}
        {straightMode ? (
          <StraightModeLayer
            along={geometry.along}
            data={straightMode}
            lowGrip={lowGrip}
            inside={zones != null && zones.zones.length > 0}
            unit={u}
          />
        ) : null}
        {overtake?.data.overtake ? (
          <OvertakeLayer along={geometry.along} data={overtake.data} unit={u} />
        ) : null}
        {markShapes.map((m) => (
          <g key={m.id} opacity={m.dim ? 0.45 : 1}>
            <title>{m.label}</title>
            {m.path ? (
              <path
                d={m.path}
                fill="none"
                stroke={COLORS.text}
                strokeOpacity={0.22}
                strokeWidth={u * 4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <circle
                cx={m.at[0]}
                cy={m.at[1]}
                r={u * 2.2}
                fill="none"
                stroke={COLORS.textDim}
                strokeWidth={u * 0.4}
              />
            )}
            {/* With all cars an automatic one is only its band (note on hover): text would sit over the cars. */}
            {cars && isAuto(m) ? null : (
              <text
                x={m.at[0]}
                y={m.at[1] - u * 3.2}
                fill={COLORS.textDim}
                fontSize={u * 2.4}
                textAnchor="middle"
              >
                {m.label.length > 28 ? `${m.label.slice(0, 27)}…` : m.label}
              </text>
            )}
          </g>
        ))}
        {cars ? <SectorFlags along={geometry.along} unit={u} /> : null}
        {passes && cars ? (
          <PassesLayer along={geometry.along} passes={passes} drivers={cars.drivers} unit={u} />
        ) : null}
        {sectors && sectors.boundaries.length > 0 ? (
          <SectorLayer along={geometry.along} boundaries={sectors.boundaries} unit={u} />
        ) : null}
        {telemetry ? (
          <ChannelLayer
            layer={telemetry}
            along={geometry.along}
            unit={u}
            lanesFrom={lanesFrom}
            dim={lap?.zoomed != null}
          />
        ) : null}
        {(telemetry || !lap ? [] : lap.sectors).map((s, i) => (
          <path
            key={i}
            d={s.d}
            fill="none"
            stroke={s.color}
            strokeWidth={u * 0.9}
            strokeLinecap="round"
            opacity={lap?.zoomed ? 0.35 : 1}
          />
        ))}
        {lap?.zoomed?.map((piece, i) => (
          <path
            key={i}
            d={piece.d}
            fill="none"
            stroke={piece.color}
            strokeWidth={u * 1.1}
            strokeLinecap="round"
          />
        ))}
        {(showCorners ? geometry.corners : []).map((c) => (
          <text
            key={c.label}
            x={c.x}
            y={c.y}
            fill={COLORS.textFaint}
            fontSize={u * 2.6}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {c.label}
          </text>
        ))}
        <g ref={ghostsRef}>
          {cars?.track.cars.flatMap((car, i) =>
            highlight.has(car.driver)
              ? ghosts.map((kind) => (
                  <g
                    key={`${car.driver}-${kind.label}`}
                    data-car={i}
                    data-loss={kind.loss}
                    data-label={`${car.driver} ${kind.label}`}
                    visibility="hidden"
                  >
                    <title>{`${car.driver} after a pit stop now (${kind.label === 'SC' ? 'under a safety car, ' : ''}${kind.loss.toFixed(1)} s lost)`}</title>
                    <circle
                      r={u * 1.5}
                      fill="none"
                      stroke={color(car.driver)}
                      strokeWidth={u * 0.45}
                      strokeDasharray={kind.label === 'SC' ? `${u * 0.8} ${u * 0.6}` : undefined}
                    />
                    <text
                      x={u * 2}
                      y={u * 2.6}
                      fill={COLORS.textDim}
                      fontSize={u * 2.2}
                      dominantBaseline="central"
                    />
                  </g>
                ))
              : []
          )}
        </g>
        <g ref={carsRef}>
          {cars?.track.cars.map((car) => {
            const strong = highlight.has(car.driver);
            return (
              <g key={car.driver} visibility="hidden">
                <title />
                <circle
                  r={u * 2.4}
                  fill="none"
                  stroke={COLORS.ers}
                  strokeWidth={u * 0.5}
                  visibility="hidden"
                />
                <circle
                  r={u * (strong ? 1.6 : 1.3)}
                  fill={color(car.driver)}
                  stroke={strong ? COLORS.text : COLORS.bg}
                  strokeWidth={u * 0.4}
                />
                <text
                  x={u * 2}
                  fill={strong ? COLORS.text : COLORS.textDim}
                  fontSize={u * 2.4}
                  fontWeight={strong ? 700 : 500}
                  dominantBaseline="central"
                >
                  {car.driver}
                </text>
              </g>
            );
          })}
        </g>
        <g ref={dotsRef}>
          {styles.map((s, n) => (
            <circle
              key={n}
              r={u * 1.4}
              fill={s.color}
              stroke={COLORS.bg}
              strokeWidth={u * 0.4}
              visibility="hidden"
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

/** Compared laps coloured by their telemetry: the first on the track, the rest as rows outside. */
const MAX_CHANNEL_LAPS = 4;
const CHANNEL_WIDTH = 1.2;
const CHANNEL_LANE_WIDTH = 0.8;

type ChannelPiece = { from: number; to: number; opacity: number };
type ChannelLayerData = {
  channel: TrackChannel;
  /** Per lap: its colour, name and the stretches (grid indices) to draw. */
  laps: { color: string; name: string; pieces: ChannelPiece[] }[];
  /** The first lap's points on the comparison grid. */
  points: Point[];
  /** Comparison grid distance → outline distance. */
  scale: number;
  distance: number[];
  /** Gear: the lowest gear per corner and per lap, at the first lap's slowest point. */
  gears: { label: string; at: Point; gears: number[] }[];
  range: [number, number];
};

function channelLayer(
  channel: TrackChannel,
  comparison: Comparison,
  points: Point[],
  styles: LapStyle[],
  along: Along
): ChannelLayerData {
  const shown = comparison.laps.slice(0, MAX_CHANNEL_LAPS);
  const range = speedRange(shown);
  const { distance } = comparison;
  const scale = along.length / (distance[distance.length - 1] || 1);
  const laps = shown.map((l, n) => ({
    color: styles[n]?.color ?? COLORS.textDim,
    name: `${l.driver} L${l.lap}`,
    pieces: levelRuns(levels(channel, l, range)).flatMap((run) => {
      const opacity = levelOpacity(channel, run.level);
      return opacity > 0 ? [{ from: run.from, to: run.to, opacity }] : [];
    }),
  }));
  const gears =
    channel === 'gear'
      ? comparison.corners.flatMap((c) => {
          const from = indexAt(distance, c.start);
          const to = indexAt(distance, c.end);
          const first = cornerGear(shown[0], from, to);
          if (!first) return [];
          const all = shown.map((l) => cornerGear(l, from, to)?.gear ?? first.gear);
          return [{ label: c.label, at: points[first.at], gears: all }];
        })
      : [];
  return { channel, laps, points, scale, distance, gears, range };
}

function ChannelLayer({
  layer,
  along,
  unit,
  lanesFrom,
  dim,
}: {
  layer: ChannelLayerData;
  along: Along;
  unit: number;
  /** Rows already taken outside the track (zones, clipping rows), in units. */
  lanesFrom: number;
  dim: boolean;
}) {
  const { distance, scale, points } = layer;
  return (
    <g fill="none" strokeLinejoin="round" opacity={dim ? 0.35 : 1}>
      {layer.laps.map((lap, n) => (
        <g key={n} stroke={lap.color}>
          <title>{lap.name}</title>
          {lap.pieces.map((p) => (
            <path
              key={p.from}
              d={
                n === 0
                  ? toPath(points.slice(p.from, p.to + 1))
                  : offsetPath(
                      along,
                      { start: distance[p.from] * scale, end: distance[p.to] * scale },
                      unit * (ZONE_OFFSET + lanesFrom + LANE_STEP * (n - 1))
                    )
              }
              strokeOpacity={p.opacity}
              strokeWidth={unit * (n === 0 ? CHANNEL_WIDTH : CHANNEL_LANE_WIDTH)}
              strokeLinecap={n === 0 ? 'round' : 'butt'}
            />
          ))}
        </g>
      ))}
      {layer.gears.map((g) => {
        const same = g.gears.every((x) => x === g.gears[0]);
        const text = same ? String(g.gears[0]) : g.gears.join('·');
        return (
          <g key={g.label} transform={`translate(${g.at[0]},${g.at[1]})`}>
            <title>{`${g.label}: lowest gear ${layer.laps.map((l, n) => `${l.name} ${g.gears[n]}`).join(', ')}`}</title>
            <rect
              x={-unit * (0.9 + 0.75 * text.length)}
              y={-unit * 1.5}
              width={unit * (1.8 + 1.5 * text.length)}
              height={unit * 3}
              fill={COLORS.bg}
              stroke={COLORS.lineStrong}
              strokeWidth={unit * 0.3}
            />
            <text
              fill={COLORS.text}
              fontSize={unit * 2.3}
              fontWeight={600}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {text}
            </text>
          </g>
        );
      })}
    </g>
  );
}

const COLOUR_CHOICES: { value: 'sectors' | TrackChannel; label: string; title: string }[] = [
  { value: 'sectors', label: 'SECTORS', title: 'Mini-sectors in the colour of the fastest lap' },
  { value: 'speed', label: 'SPEED', title: 'The laps’ speed: the stronger, the faster' },
  { value: 'throttle', label: 'THROTTLE', title: 'Braking, rolling, part and full throttle' },
  { value: 'gear', label: 'GEAR', title: 'The gear, and the lowest gear of every corner' },
];

/** Top left over the map: what colours the track (buttons) and the key to it. */
function ColourLegend({
  colour,
  onColour,
  names,
  range,
}: {
  colour: 'sectors' | TrackChannel;
  onColour?: (colour: 'sectors' | TrackChannel) => void;
  names: string[];
  range?: [number, number];
}) {
  return (
    <div className="absolute left-1.5 top-1 z-10 flex flex-col gap-0.5 text-[10px] text-faint">
      <div className="flex items-center gap-2">
        {COLOUR_CHOICES.map((c) => (
          <button
            key={c.value}
            type="button"
            title={c.title}
            onClick={() => onColour?.(c.value)}
            className={
              c.value === colour ? 'font-semibold text-text' : 'font-semibold hover:text-dim'
            }
          >
            {c.label}
          </button>
        ))}
      </div>
      {colour === 'sectors' ? (
        <span>Mini-sectors: fastest lap colours the track</span>
      ) : (
        <>
          <span className="flex items-center gap-1.5">
            {colour === 'throttle'
              ? THROTTLE_LEVELS.map((l) => (
                  <Swatch key={l.label} opacity={l.opacity} label={l.label} />
                ))
              : colour === 'gear'
                ? Array.from({ length: 8 }, (_, g) => (
                    <Swatch key={g} opacity={levelOpacity('gear', g + 1)} label={String(g + 1)} />
                  ))
                : [
                    <span key="lo" className="tabular-nums">
                      {range ? Math.round(range[0]) : ''}
                    </span>,
                    ...Array.from({ length: SPEED_BANDS }, (_, b) => (
                      <Swatch key={b} opacity={levelOpacity('speed', b + 1)} />
                    )),
                    <span key="hi" className="tabular-nums">
                      {range ? `${Math.round(range[1])} km/h` : ''}
                    </span>,
                  ]}
            {names.length > 1 ? (
              <span className="ml-1">
                {names[0]} on the track, {names.slice(1).join(', ')} outside
              </span>
            ) : null}
          </span>
        </>
      )}
    </div>
  );
}

function Swatch({ opacity, label }: { opacity: number; label?: string }) {
  return (
    <span className="flex items-center gap-0.5">
      <span className="h-1.5 w-2.5 border border-line-strong">
        <span className="block h-full w-full bg-dim" style={{ opacity }} />
      </span>
      {label}
    </span>
  );
}

const ZONE_OFFSET = 2.1;
const ZONE_WIDTH = 0.9;
const LANE_STEP = 1.1;
const LANE_WIDTH = 0.6;

/** DRS zones or straights as a purple stripe outside the track, amber from where the session
 * usually clips; outside that a thin amber row per compared lap where it clipped. */
function ZoneLayer({
  along,
  zones,
  lapClips,
  unit,
}: {
  along: Along;
  zones: TrackZones;
  lapClips?: LapClips[];
  unit: number;
}) {
  const offset = unit * ZONE_OFFSET;
  return (
    <g strokeLinecap="butt" strokeLinejoin="round" fill="none">
      {zones.zones.map((zone) => (
        <g key={zone.label}>
          <title>
            {zone.clip_at != null
              ? `${zone.label}: most laps clip from ${Math.round(zone.clip_at)} m ` +
                `(${Math.round(zone.clipping * 100)}% of clean laps)`
              : zone.label}
          </title>
          <path
            d={offsetPath(along, zone, offset)}
            stroke={COLORS.ers}
            strokeWidth={unit * ZONE_WIDTH}
          />
          {zone.clip_at != null ? (
            <path
              d={offsetPath(along, { start: zone.clip_at, end: zone.end }, offset)}
              stroke={COLORS.clip}
              strokeWidth={unit * ZONE_WIDTH}
            />
          ) : null}
        </g>
      ))}
      {lapClips?.map(({ name, stretches, superclips }, lane) => (
        <g key={lane}>
          {stretches.map((stretch) => (
            <path
              key={stretch.start}
              d={offsetPath(along, stretch, offset + unit * LANE_STEP * (lane + 1))}
              stroke={COLORS.clipFaint}
              strokeWidth={unit * LANE_WIDTH}
            >
              <title>{`${name} clips here (${Math.round(stretch.end - stretch.start)} m)`}</title>
            </path>
          ))}
          {superclips.map((stretch) => (
            <path
              key={`super-${stretch.start}`}
              d={offsetPath(along, stretch, offset + unit * LANE_STEP * (lane + 1))}
              stroke={COLORS.clip}
              strokeWidth={unit * LANE_WIDTH}
            >
              <title>{`${name} loses speed at full throttle here (superclipping)`}</title>
            </path>
          ))}
        </g>
      ))}
      {zones.kind === 'drs'
        ? zones.zones.map((zone) => {
            const i = indexAt(
              along.distance,
              zone.start < 0 ? zone.start + along.length : zone.start
            );
            const [x, y] = along.points[i];
            const [nx, ny] = along.normals[i];
            return (
              <text
                key={`label-${zone.label}`}
                x={x + nx * unit * 4.5}
                y={y + ny * unit * 4.5}
                fill={COLORS.textFaint}
                fontSize={unit * 2.2}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {zone.label}
              </text>
            );
          })
        : null}
    </g>
  );
}

function ZoneLegend({ zones }: { zones: TrackZones }) {
  const session = useSelection((s) => s.session);
  const clips = zones.zones.some((z) => z.clip_at != null);
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex items-center gap-1">
        <span className="h-[3px] w-3 bg-ers" />
        {zones.kind === 'drs'
          ? `DRS zones${zones.source && zones.source !== session ? ` (from ${zones.source})` : ''}`
          : 'Full-throttle straights (estimate)'}
      </span>
      {clips ? (
        <span className="flex items-center gap-1">
          <span className="h-[3px] w-3 bg-clip" />
          Most laps clip from here
        </span>
      ) : null}
    </div>
  );
}

const STRAIGHT_MODE_OFFSET = 2.1;
const STRAIGHT_MODE_WIDTH = 0.7;

/** Straight-mode zones (2026) as a grey stripe outside the track like the DRS zones were, or
 * inside it when the straights and clipping are shown outside; the zone's name at its start. In
 * low grip (race control, at the clock) the later low-grip starts. */
function StraightModeLayer({
  along,
  data,
  lowGrip,
  inside,
  unit,
}: {
  along: Along;
  data: StraightMode;
  lowGrip: boolean;
  inside: boolean;
  unit: number;
}) {
  // The zones are on the session's lap, the map on the outline's length.
  const scale = data.length > 0 ? along.length / data.length : 1;
  const side = inside ? -1 : 1;
  const offset = side * unit * STRAIGHT_MODE_OFFSET;
  return (
    <g strokeLinecap="butt" strokeLinejoin="round" fill="none">
      {activeZones(data, lowGrip).map((zone) => {
        const start = zone.start * scale;
        const i = indexAt(along.distance, start < 0 ? start + along.length : start);
        const [x, y] = along.points[i];
        const [nx, ny] = along.normals[i];
        return (
          <g key={zone.label}>
            <title>{describeZone(zone, lowGrip)}</title>
            <path
              d={offsetPath(along, { start, end: zone.end * scale }, offset)}
              stroke={COLORS.textDim}
              strokeWidth={unit * STRAIGHT_MODE_WIDTH}
            />
            <text
              x={x + side * nx * unit * 4.5}
              y={y + side * ny * unit * 4.5}
              fill={COLORS.textFaint}
              fontSize={unit * 2.2}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {zone.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function StraightModeLegend({ data, lowGrip }: { data: StraightMode; lowGrip: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-[2px] w-3 bg-dim" />
      {data.zones.length === 0
        ? data.source
          ? 'No straight-mode zones here (FIA map)'
          : 'No FIA straight-mode zones for this event'
        : lowGrip
          ? 'Straight mode (FIA), low grip: front wing only'
          : 'Straight mode zones (FIA)'}
    </span>
  );
}

const OVERTAKE_TICK = 2.6;
const OVERTAKE_LABEL = 5.5;

/** The FIA's overtake detection (OT D) and activation (OT A) lines across the track, the label
 * outside it. */
function OvertakeLayer({ along, data, unit }: { along: Along; data: StraightMode; unit: number }) {
  const points = data.overtake;
  if (!points) return null;
  const scale = data.length > 0 ? along.length / data.length : 1;
  const lines = [
    { label: 'OT D', at: points.detection, title: `Overtake detection: ${points.detection_text}` },
    {
      label: 'OT A',
      at: points.activation,
      title: `Overtake activation: ${points.activation_text}`,
    },
  ];
  return (
    <g>
      {lines.map((line) => {
        const i = Math.min(indexAt(along.distance, line.at * scale), along.points.length - 1);
        const [x, y] = along.points[i];
        const [nx, ny] = along.normals[i];
        const tick = unit * OVERTAKE_TICK;
        return (
          <g key={line.label}>
            <title>{`${line.title} (FIA circuit map, ±50 m)`}</title>
            <line
              x1={x - nx * tick}
              y1={y - ny * tick}
              x2={x + nx * tick}
              y2={y + ny * tick}
              stroke={COLORS.ers}
              strokeWidth={unit * 0.5}
            />
            <text
              x={x + nx * unit * OVERTAKE_LABEL}
              y={y + ny * unit * OVERTAKE_LABEL}
              fill={COLORS.ers}
              fontSize={unit * 2.2}
              fontWeight={600}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {line.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Seconds a pass stays big on the map after it happened. */
const PASS_RECENT = 60;
/** Dots stacked outward per place before the rest is a count. */
const PASS_STACK = 5;
/** Spacing of the dots in a column, in map units. */
const PASS_STEP = 1.3;

/** Every pass up to the clock as a dot just outside the track, in the passer's colour: passes
 * at the same place stack outward in the order they happened (a column = a passing place), the
 * last minute's big, older ones faint. A column taller than PASS_STACK ends in "+n". */
function PassesLayer({
  along,
  passes,
  drivers,
  unit,
}: {
  along: Along;
  passes: Pass[];
  drivers: DriverInfo[];
  unit: number;
}) {
  const t = useClockTime(1000);
  const color = (code: string) => drivers.find((d) => d.code === code)?.color ?? COLORS.textDim;
  // Columns from the passes in time order, so the dots up to t are always the inner ones.
  const placed = useMemo(() => {
    const columns: { x: number; y: number; nx: number; ny: number; count: number }[] = [];
    return passes.map((p) => {
      const i = Math.min(
        indexAt(along.distance, p.fraction * along.length),
        along.points.length - 1
      );
      const [x, y] = along.points[i];
      let column = columns.find((c) => Math.hypot(c.x - x, c.y - y) < unit * 2);
      if (!column) {
        const [nx, ny] = along.normals[i];
        column = { x, y, nx, ny, count: 0 };
        columns.push(column);
      }
      const level = column.count++;
      return { pass: p, column, level };
    });
  }, [along, passes, unit]);
  const shown = placed.filter((d) => d.pass.time <= t);
  const overflow = new Map<(typeof placed)[number]['column'], number>();
  for (const d of shown) {
    if (d.level >= PASS_STACK) overflow.set(d.column, d.level + 1 - PASS_STACK);
  }
  // "+n" past the full columns, the biggest first; one that would touch another is left out.
  const labels: { x: number; y: number; anchor: 'start' | 'middle' | 'end'; more: number }[] = [];
  const out = unit * (3.6 + PASS_STACK * PASS_STEP + 0.4);
  for (const [c, more] of [...overflow].sort((a, b) => b[1] - a[1])) {
    const [x, y] = [c.x + c.nx * out, c.y + c.ny * out];
    if (labels.some((l) => Math.hypot(l.x - x, l.y - y) < unit * 4)) continue;
    labels.push({ x, y, more, anchor: c.nx < -0.3 ? 'end' : c.nx > 0.3 ? 'start' : 'middle' });
  }
  return (
    <g>
      {shown.map(({ pass: p, column: c, level }) => {
        if (level >= PASS_STACK) return null;
        const recent = t - p.time < PASS_RECENT;
        const out = unit * (3.6 + level * PASS_STEP);
        return (
          <circle
            key={`${p.time}-${p.driver}-${p.passed}`}
            cx={c.x + c.nx * out}
            cy={c.y + c.ny * out}
            r={unit * (recent ? 1 : 0.55)}
            fill={color(p.driver)}
            opacity={recent ? 1 : 0.55}
          >
            <title>{`L${p.lap} ${p.driver} past ${p.passed} into ${p.corner ?? '?'}${p.overtake_mode ? ' (overtake mode)' : ''}`}</title>
          </circle>
        );
      })}
      {labels.map(({ x, y, anchor, more }) => (
        <text
          key={`${x},${y}`}
          x={x}
          y={y}
          fill={COLORS.textDim}
          fontSize={unit * 1.8}
          textAnchor={anchor}
          dominantBaseline="central"
        >
          +{more}
        </text>
      ))}
    </g>
  );
}

function PassesLegend({ passes }: { passes: Pass[] }) {
  const t = useClockTime(1000);
  const count = passes.filter((p) => p.time <= t).length;
  return (
    <span className="flex items-center gap-1">
      <span className="h-1.5 w-1.5 rounded-full bg-dim" />
      {count} {count === 1 ? 'pass' : 'passes'} up to the clock, a dot each in the passer’s colour
    </span>
  );
}

function OvertakeLegend() {
  return (
    <span className="flex items-center gap-1">
      <span className="h-2 w-2 rounded-full border border-ers" />
      Overtake mode: within 1 s at OT D
    </span>
  );
}

function EnergyLegend({ name }: { name: string }) {
  return (
    <div className="absolute bottom-1 right-1.5 z-10 flex items-center gap-2.5 text-[10px] text-faint">
      <span>{name}</span>
      <span className="flex items-center gap-1">
        <span className="h-[3px] w-3 bg-ers" />
        Deploying (est.)
      </span>
      <span className="flex items-center gap-1">
        <span className="h-[3px] w-3 bg-clip/45" />
        Clipping
      </span>
      <span className="flex items-center gap-1">
        <span className="h-[3px] w-3 bg-clip" />
        Losing speed
      </span>
    </div>
  );
}

const SECTOR_TICK = 2.6;
const SECTOR_LABEL = 5;

/** The line and the ends of sector 1 and 2 as ticks across the track, each sector's name at
 * its start just inside the track (corner numbers mostly sit outside). */
function SectorLayer({
  along,
  boundaries,
  unit,
}: {
  along: Along;
  boundaries: number[];
  unit: number;
}) {
  const at = (d: number) => {
    const i = Math.min(indexAt(along.distance, d), along.points.length - 1);
    return { point: along.points[i], normal: along.normals[i] };
  };
  return (
    <g>
      {[0, ...boundaries].map((d, n) => {
        const {
          point: [x, y],
          normal: [nx, ny],
        } = at(d);
        const tick = unit * SECTOR_TICK;
        return (
          <g key={n}>
            <line
              x1={x - nx * tick}
              y1={y - ny * tick}
              x2={x + nx * tick}
              y2={y + ny * tick}
              stroke={COLORS.textDim}
              strokeWidth={unit * 0.5}
            >
              <title>
                {n === 0 ? 'Start/finish line' : `End of sector ${n} (${Math.round(d)} m)`}
              </title>
            </line>
            <text
              x={x - nx * unit * SECTOR_LABEL}
              y={y - ny * unit * SECTOR_LABEL}
              fill={COLORS.textFaint}
              fontSize={unit * 2.4}
              fontWeight={600}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {`S${n + 1}`}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Yellow flags at the session clock: the marshal sector drawn in yellow along the track. */
function SectorFlags({ along, unit }: { along: Along; unit: number }) {
  const flags = useSectorFlags();
  return (
    <>
      {flags.flatMap((f) =>
        f.ranges.map(([start, end]) => {
          const from = indexAt(along.distance, start);
          const to = Math.max(indexAt(along.distance, end), from + 1);
          return (
            <path
              key={`${f.sector}-${start}`}
              d={toPath(along.points.slice(from, to + 1))}
              fill="none"
              stroke={COLORS.slow}
              strokeWidth={unit * (f.double ? 2.6 : 1.6)}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <title>{`${f.double ? 'Double yellow' : 'Yellow'} in sector ${f.sector}`}</title>
            </path>
          );
        })
      )}
    </>
  );
}

/** A marker on the outline: the stretch it covers (or none for a point) and where its label goes. */
function markShape(
  mark: DistanceMark,
  along: { points: Point[]; distance: number[] },
  unit: number
): DistanceMark & { path: string | null; at: Point } {
  const from = indexAt(along.distance, mark.start);
  if (mark.end == null) {
    const at = along.points[Math.min(from, along.points.length - 1)];
    return { ...mark, path: null, at: [at[0], at[1] - unit] };
  }
  const to = Math.max(indexAt(along.distance, mark.end), from + 1);
  const points = along.points.slice(from, to + 1);
  return { ...mark, path: toPath(points), at: points[Math.floor(points.length / 2)] };
}
