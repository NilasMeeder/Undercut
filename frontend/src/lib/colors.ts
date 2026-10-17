/** Canvas charts can't read CSS variables cheaply; keep in sync with src/index.css. */
export const COLORS = {
  bg: '#08080a',
  line: '#1f1f25',
  lineStrong: '#2c2c33',
  text: '#e8e8ec',
  textDim: '#a0a0aa',
  textFaint: '#63636d',
  best: '#b46cff',
  pb: '#34d36e',
  slow: '#f2c230',
  pit: '#ff5252',
  /** Markers: neutral, they are notes and carry no timing meaning. */
  markerFill: 'rgba(232, 232, 236, 0.08)',
} as const;

/** Track flags keep their real-world colours; anything else (chequered, clear) stays neutral. */
export const FLAG_COLORS: Record<string, string> = {
  GREEN: COLORS.pb,
  CLEAR: COLORS.pb,
  YELLOW: COLORS.slow,
  'DOUBLE YELLOW': COLORS.slow,
  RED: COLORS.pit,
  BLUE: '#3f8cff',
  CHEQUERED: COLORS.text,
};

export const TYRE_COLORS: Record<string, string> = {
  SOFT: '#ff4040',
  MEDIUM: '#ffd23a',
  HARD: '#ececec',
  INTERMEDIATE: '#3fcf55',
  WET: '#3f8cff',
};

/** Dash patterns for repeated colours (teammates, or two laps of one driver). */
export const DASHES: (number[] | undefined)[] = [undefined, [6, 4], [2, 3], [10, 3, 2, 3]];

/** Track status on the clock bar and timing tower: flag colours, green stays unmarked. */
export const TRACK_STATUS_COLORS: Record<string, string> = {
  green: COLORS.pb,
  yellow: COLORS.slow,
  sc: COLORS.slow,
  vsc: COLORS.slow,
  vsc_ending: COLORS.slow,
  red: COLORS.pit,
  chequered: COLORS.textFaint,
};
