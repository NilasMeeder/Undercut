import type { Championship, TowerRow } from '@/api/client';

/** The championship as it stands (widget Championship): standings before + points at the clock. */

export type StandingRow = {
  name: string;
  team: string;
  before: number;
  now: number;
  was: number;
  is: number;
};

/** Points per driver for the order at the clock: out of the race scores nothing. */
export function sessionPoints(
  rows: TowerRow[],
  table: Championship,
  fastest: string | null
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const scored = row.status === 'retired' ? 0 : (table.points[row.position - 1] ?? 0);
    out.set(row.driver, scored);
  }
  if (table.fastest_lap_point && fastest) {
    const row = rows.find((r) => r.driver === fastest);
    if (row && row.status !== 'retired' && row.position <= 10) {
      out.set(fastest, (out.get(fastest) ?? 0) + 1);
    }
  }
  return out;
}

/** The standings before and now, with each one's place before and now (ties: more wins first). */
export function standings(
  entries: Championship['drivers'],
  scored: (name: string) => number,
  won: (name: string) => boolean
): StandingRow[] {
  const order = (key: (e: Championship['drivers'][number]) => [number, number]) =>
    [...entries]
      .sort((a, b) => {
        const [pa, wa] = key(a);
        const [pb, wb] = key(b);
        return pb - pa || wb - wa || a.name.localeCompare(b.name);
      })
      .map((e) => e.name);
  const before = order((e) => [e.points, e.wins]);
  const now = order((e) => [e.points + scored(e.name), e.wins + (won(e.name) ? 1 : 0)]);
  return now.map((name, i) => {
    const e = entries.find((x) => x.name === name)!;
    return {
      name,
      team: e.team,
      before: e.points,
      now: e.points + scored(name),
      was: before.indexOf(name) + 1,
      is: i + 1,
    };
  });
}
