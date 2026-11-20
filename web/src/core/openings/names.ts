import type { PosKey } from '../repertoire/types';

/** ECO code and name of an opening position (Lichess chess-openings, CC0). */
export type OpeningName = { eco: string; name: string };

/** Position key → "ECO|Name". */
export type OpeningTable = Readonly<Record<string, string>>;

let table: Promise<OpeningTable> | null = null;

/** Loads the table once (a separate chunk, about 60 kB compressed). */
export function loadOpenings(): Promise<OpeningTable> {
  table ??= import('./openings.json').then((m) => m.default as OpeningTable);
  return table;
}

export function lookup(t: OpeningTable, key: PosKey): OpeningName | null {
  const v = t[key];
  if (!v) return null;
  const i = v.indexOf('|');
  return { eco: v.slice(0, i), name: v.slice(i + 1) };
}

/**
 * The opening of the last named position along a line (`keys`: positions from the start, in
 * order), with how many of them it took. Null when none is named.
 */
export function openingOf(t: OpeningTable, keys: readonly PosKey[]): (OpeningName & { at: number }) | null {
  for (let i = keys.length - 1; i >= 0; i--) {
    const o = lookup(t, keys[i]!);
    if (o) return { ...o, at: i };
  }
  return null;
}

/** "Caro-Kann Defense: Advance Variation" → "Caro-Kann Defense" (the family, before the colon). */
export const family = (name: string): string => name.split(':')[0]!.trim();
