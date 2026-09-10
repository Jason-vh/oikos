export const CURRENT_VERSION = 3 as const;

type RawRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasRecoverableGeometry(parsed: RawRecord): boolean {
  return parsed.island === 'kalliste' && Number.isInteger(parsed.seed);
}

const MIGRATIONS: Record<number, (parsed: RawRecord) => RawRecord | null> = {
  1: migrateV1toV2,
  2: migrateV2toV3,
};

export function migrateSave(parsed: RawRecord): RawRecord | null {
  let migrated = parsed;
  while (migrated.version !== CURRENT_VERSION) {
    if (!Number.isInteger(migrated.version)) return null;
    const step = MIGRATIONS[migrated.version as number];
    if (!step) return null;
    const next = step(migrated);
    if (!next) return null;
    migrated = next;
  }
  return migrated;
}

function migrateV1toV2(parsed: RawRecord): RawRecord | null {
  if (!hasRecoverableGeometry(parsed)) return null;
  return {
    ...parsed,
    version: 2,
    wildlife: migrateWildlife(parsed.wildlife),
    felled: parsed.felled === undefined ? [] : parsed.felled,
    regrowth: parsed.regrowth === undefined ? 0 : parsed.regrowth,
    walkers: migrateWalkers(parsed.walkers),
  };
}

function migrateV2toV3(parsed: RawRecord): RawRecord | null {
  return {
    ...parsed,
    version: 3,
    harbour: parsed.harbour === undefined ? { tier: 1, stores: {}, vendorEnabled: false, vendorInstalled: false, progress: 0 } : parsed.harbour,
  };
}

function migrateWildlife(raw: unknown): unknown {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return raw;
  return raw.map(migrateAnimal);
}

function migrateAnimal(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;
  return {
    ...raw,
    respawn: raw.respawn === undefined ? 0 : raw.respawn,
    cornered: raw.cornered === undefined ? false : raw.cornered,
  };
}

function migrateWalkers(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map(migrateWalker);
}

function migrateWalker(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;
  return {
    ...raw,
    overland: raw.overland === undefined ? [] : raw.overland,
    quarry: raw.quarry === undefined ? null : raw.quarry,
    working: raw.working === undefined ? 0 : raw.working,
  };
}
