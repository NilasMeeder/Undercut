import type { ReactNode } from 'react';

// A seven-segment display in SVG: crisp at any size, no font to load.

const W = 56; // digit cell
const H = 100;
const T = 11; // segment thickness
const GAP = 2;
const SPACE = 12; // between characters
const COLON = T;
const SKEW = 6; // degrees, as on a timing board
const LEAN = Math.tan((SKEW * Math.PI) / 180) * H;

function horizontal(y: number): string {
  const x0 = T / 2 + GAP;
  const x1 = W - T / 2 - GAP;
  const h = T / 2;
  return `${x0},${y} ${x0 + h},${y - h} ${x1 - h},${y - h} ${x1},${y} ${x1 - h},${y + h} ${x0 + h},${y + h}`;
}

function vertical(x: number, y0: number, y1: number): string {
  const h = T / 2;
  const a = y0 + GAP;
  const b = y1 - GAP;
  return `${x},${a} ${x + h},${a + h} ${x + h},${b - h} ${x},${b} ${x - h},${b - h} ${x - h},${a + h}`;
}

const L = T / 2;
const R = W - T / 2;
const TOP = T / 2;
const MID = H / 2;
const BOTTOM = H - T / 2;

// Segments a–g: top, top right, bottom right, bottom, bottom left, top left, middle.
const SEGMENTS = [
  horizontal(TOP),
  vertical(R, TOP, MID),
  vertical(R, MID, BOTTOM),
  horizontal(BOTTOM),
  vertical(L, MID, BOTTOM),
  vertical(L, TOP, MID),
  horizontal(MID),
];

const GLYPHS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgedc',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  ' ': '',
};

function Digit({ char, x }: { char: string; x: number }) {
  const lit = GLYPHS[char] ?? '';
  return (
    <g transform={`translate(${x} 0)`}>
      {SEGMENTS.map((points, i) => (
        <polygon key={i} points={points} opacity={lit.includes('abcdefg'[i]) ? 1 : 0.07} />
      ))}
    </g>
  );
}

/**
 * Digits, spaces, '-' and ':' in segments, scaled to fit its box (keeps its aspect ratio, centred).
 * Colour comes from `currentColor`; unlit segments show faintly, as on a real display.
 */
export function SegmentDisplay({ text, className }: { text: string; className?: string }) {
  let x = 0;
  const parts: ReactNode[] = [];
  [...text].forEach((char, i) => {
    if (char === ':') {
      parts.push(
        <g key={i}>
          <rect x={x} y={H * 0.3 - T / 2} width={T} height={T} />
          <rect x={x} y={H * 0.7 - T / 2} width={T} height={T} />
        </g>
      );
      x += COLON + SPACE;
    } else {
      parts.push(<Digit key={i} char={char} x={x} />);
      x += W + SPACE;
    }
  });
  const width = Math.max(0, x - SPACE) + LEAN;
  return (
    <svg
      viewBox={`0 0 ${width} ${H}`}
      className={className}
      fill="currentColor"
      role="img"
      aria-label={text}
    >
      <g transform={`translate(${LEAN} 0) skewX(${-SKEW})`}>{parts}</g>
    </svg>
  );
}
