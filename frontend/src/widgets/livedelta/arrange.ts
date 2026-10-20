/**
 * Where everything in Live delta goes, for a panel of w × h px: the layout follows the panel's
 * shape instead of scaling one fixed block (Nilas: "een soort blok").
 * - `stack`: the gap ahead on top, the driver beside the delta, the gap behind at the bottom.
 * - `tall`: everything under each other, the delta across the full width.
 * - `row`: ahead | driver and delta | behind, for a wide, flat panel.
 * - `mini`: only the delta, for a small panel.
 */

export type Kind = 'stack' | 'tall' | 'row' | 'mini';

export type Spot = { x: number; y: number; size: number; anchor: 'start' | 'middle' | 'end' };

export type Arrangement = {
  kind: Kind;
  delta: Spot;
  /** Driver name with the team bar in front; absent in `mini`. */
  driver?: Spot;
  /** "P3  L48" and "vs L47": under the name, or after it on one line (`row`, `tall`). */
  sub?: Spot;
  reference?: Spot;
  ahead?: { label: Spot; gap: Spot };
  behind?: { label: Spot; gap: Spot };
};

/** Width of one character as a share of the font size (tabular digits, capitals). */
const CHAR = 0.62;
/** Characters the delta (−0.125) and a gap (13.896, +2 LAPS) are sized for. */
const DELTA_CHARS = 6;
const GAP_CHARS = 7;

/** The largest font size for `chars` characters within `width`, at most `max`. */
const fit = (width: number, chars: number, max: number) =>
  Math.max(6, Math.min(max, width / (chars * CHAR)));

export function arrange(w: number, h: number): Arrangement {
  const pad = Math.max(4, Math.round(Math.min(w, h) * 0.04));
  const inner = w - 2 * pad;

  if (w < 170 || (h < 90 && w < 300)) {
    const size = fit(inner, DELTA_CHARS, h * 0.8);
    return { kind: 'mini', delta: { x: w / 2, y: h / 2 + size * 0.36, size, anchor: 'middle' } };
  }

  if (w >= 3.2 * h) {
    // Three columns: the gaps on the outside, the delta in the middle.
    const side = w * 0.24;
    const gapSize = fit(side, GAP_CHARS, h * 0.42);
    const labelSize = Math.min(gapSize * 0.55, h * 0.24);
    const nameSize = Math.min(h * 0.2, w * 0.03);
    const deltaSize = fit(w * 0.5, DELTA_CHARS, h - 2 * pad - nameSize * 1.2);
    const top = (h - (labelSize + gapSize * 1.05)) / 2 + labelSize;
    const deltaBase = h - pad - deltaSize * 0.12;
    return {
      kind: 'row',
      ahead: {
        label: { x: pad, y: top, size: labelSize, anchor: 'start' },
        gap: { x: pad, y: top + gapSize * 1.05, size: gapSize, anchor: 'start' },
      },
      behind: {
        label: { x: w - pad, y: top, size: labelSize, anchor: 'end' },
        gap: { x: w - pad, y: top + gapSize * 1.05, size: gapSize, anchor: 'end' },
      },
      driver: { x: w * 0.27, y: pad + nameSize, size: nameSize, anchor: 'start' },
      sub: {
        x: w * 0.27 + nameSize * 3.2,
        y: pad + nameSize,
        size: nameSize * 0.7,
        anchor: 'start',
      },
      delta: { x: w / 2, y: deltaBase, size: deltaSize, anchor: 'middle' },
    };
  }

  if (h > 1.15 * w) {
    // Under each other, the delta as wide as the panel; the space left over goes between.
    const deltaSize = fit(inner, DELTA_CHARS, h * 0.3);
    const gapSize = fit(inner * 0.6, GAP_CHARS, deltaSize * 0.5);
    const labelSize = gapSize * 0.6;
    const nameSize = deltaSize * 0.32;
    const heights = [gapSize, nameSize, deltaSize * 0.8, nameSize * 0.6, gapSize];
    const space = (h - 2 * pad - heights.reduce((a, b) => a + b, 0)) / (heights.length - 1);
    const base: number[] = [];
    heights.reduce((y, height) => {
      base.push(y + height);
      return y + height + space;
    }, pad);
    const [aheadY, nameY, deltaY, referenceY, behindY] = base;
    return {
      kind: 'tall',
      ahead: {
        label: { x: pad, y: aheadY, size: labelSize, anchor: 'start' },
        gap: { x: w - pad, y: aheadY, size: gapSize, anchor: 'end' },
      },
      driver: { x: pad, y: nameY, size: nameSize, anchor: 'start' },
      sub: { x: w - pad, y: nameY, size: nameSize * 0.6, anchor: 'end' },
      delta: { x: w - pad, y: deltaY, size: deltaSize, anchor: 'end' },
      reference: { x: w - pad, y: referenceY, size: nameSize * 0.6, anchor: 'end' },
      behind: {
        label: { x: pad, y: behindY, size: labelSize, anchor: 'start' },
        gap: { x: w - pad, y: behindY, size: gapSize, anchor: 'end' },
      },
    };
  }

  // Stack: three bands, the middle one the largest.
  const band = h * 0.22;
  const middle = h - 2 * band;
  const gapSize = fit(inner * 0.6, GAP_CHARS, band * 0.8);
  const labelSize = Math.min(gapSize * 0.6, band * 0.6);
  const nameSize = Math.min(middle * 0.28, w * 0.075);
  const block = nameSize * 3.4;
  const deltaSize = fit(inner - block - pad, DELTA_CHARS, middle * 0.85);
  const centre = band + middle / 2;
  const row = (y: number) => y + band / 2 + gapSize * 0.36;
  return {
    kind: 'stack',
    ahead: {
      label: { x: pad, y: row(0), size: labelSize, anchor: 'start' },
      gap: { x: w - pad, y: row(0), size: gapSize, anchor: 'end' },
    },
    driver: { x: pad, y: centre - nameSize * 0.15, size: nameSize, anchor: 'start' },
    sub: { x: pad, y: centre + nameSize * 0.6, size: nameSize * 0.55, anchor: 'start' },
    reference: { x: pad, y: centre + nameSize * 1.25, size: nameSize * 0.5, anchor: 'start' },
    delta: { x: w - pad, y: centre + deltaSize * 0.36, size: deltaSize, anchor: 'end' },
    behind: {
      label: { x: pad, y: row(band + middle), size: labelSize, anchor: 'start' },
      gap: { x: w - pad, y: row(band + middle), size: gapSize, anchor: 'end' },
    },
  };
}
