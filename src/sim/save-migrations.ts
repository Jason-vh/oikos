import { islandFor } from './island';

export const CURRENT_VERSION = 6 as const;
export const ARCHIPELAGO_VERSION = 4;

type RawRecord = Record<string, unknown>;

export function migrateSave(parsed: RawRecord): RawRecord | null {
  if (parsed.version === CURRENT_VERSION) return parsed;
  if (parsed.version === 5) return { ...parsed, version: CURRENT_VERSION };
  if (parsed.version !== ARCHIPELAGO_VERSION) return null;
  const { seed } = parsed;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
  return { ...parsed, version: CURRENT_VERSION, home: islandFor(seed).home };
}
