export function formatLapTime(seconds: number | null | undefined): string {
  if (seconds == null) return '';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(3).padStart(6, '0')}`;
}

export function formatSector(seconds: number | null | undefined): string {
  return seconds == null ? '' : seconds.toFixed(3);
}

export function formatGap(seconds: number | null | undefined): string {
  if (seconds == null) return '';
  // Round first: -0.0004 is +0.000, not −0.000 (sums of sector times are a float off).
  const rounded = Math.round(seconds * 1000) / 1000;
  const sign = rounded < 0 ? '−' : '+';
  return `${sign}${Math.abs(rounded).toFixed(3)}`;
}

/** Axis label for a distance; `step` (the tick spacing) switches to whole metres when zoomed in. */
export function formatDistance(metres: number, step = Infinity): string {
  if (metres < 1000 || step < 100) return `${Math.round(metres)}`;
  return `${(metres / 1000).toFixed(1)}k`;
}
