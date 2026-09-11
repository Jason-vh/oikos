export const CURRENT_VERSION = 4 as const;

type RawRecord = Record<string, unknown>;

export function migrateSave(parsed: RawRecord): RawRecord | null {
  return parsed.version === CURRENT_VERSION ? parsed : null;
}
