import { islandFor } from './island';

export const CURRENT_VERSION = 10 as const;
export const ARCHIPELAGO_VERSION = 4;

type RawRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nestCity(flat: RawRecord): RawRecord {
  const { home, founded, money, harbour, produced, delivered, roads, buildings, walkers, ...rest } = flat;
  return { ...rest, cities: [{ id: 1, home, founded, money, harbour, produced, delivered, roads, buildings, walkers }] };
}

function nestCollections(v8: RawRecord): RawRecord | null {
  const { roads, buildings, walkers, cities, ...rest } = v8;
  if (!Array.isArray(cities) || cities.length !== 1 || !isPlainObject(cities[0])) return null;
  return { ...rest, cities: [{ ...cities[0], roads, buildings, walkers }] };
}

function addCityIdAllocator(v9: RawRecord | null): RawRecord | null {
  if (!v9) return null;
  const { cities, ...rest } = v9;
  if (!Array.isArray(cities) || cities.length !== 1 || !isPlainObject(cities[0])) return null;
  const id = cities[0].id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || id >= Number.MAX_SAFE_INTEGER) return null;
  return { ...rest, version: CURRENT_VERSION, cities, nextCityId: id + 1 };
}

export function migrateSave(parsed: RawRecord): RawRecord | null {
  if (parsed.version === CURRENT_VERSION) return parsed;
  if (parsed.version === 9) return addCityIdAllocator(parsed);
  if (parsed.version === 8) return addCityIdAllocator(nestCollections(parsed));
  if (parsed.version === 7) return addCityIdAllocator(nestCity(parsed));
  if (parsed.version === 5 || parsed.version === 6) return addCityIdAllocator(nestCity({ ...parsed, founded: true }));
  if (parsed.version !== ARCHIPELAGO_VERSION) return null;
  const { seed } = parsed;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
  return addCityIdAllocator(nestCity({ ...parsed, home: islandFor(seed).home, founded: true }));
}
