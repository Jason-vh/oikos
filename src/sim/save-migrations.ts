import { islandFor } from './island';

export const CURRENT_VERSION = 8 as const;
export const ARCHIPELAGO_VERSION = 4;

type RawRecord = Record<string, unknown>;

function nestCity(flat: RawRecord): RawRecord {
  const { home, founded, money, harbour, produced, delivered, ...rest } = flat;
  return { ...rest, version: CURRENT_VERSION, cities: [{ id: 1, home, founded, money, harbour, produced, delivered }] };
}

export function migrateSave(parsed: RawRecord): RawRecord | null {
  if (parsed.version === CURRENT_VERSION) return parsed;
  if (parsed.version === 7) return nestCity(parsed);
  if (parsed.version === 5 || parsed.version === 6) return nestCity({ ...parsed, founded: true });
  if (parsed.version !== ARCHIPELAGO_VERSION) return null;
  const { seed } = parsed;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
  return nestCity({ ...parsed, home: islandFor(seed).home, founded: true });
}
