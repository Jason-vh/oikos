import { describe, expect, test } from 'bun:test';
import { deserializeWorld, serializeWorld } from './save';
import { CURRENT_VERSION, migrateSave } from './save-migrations';
import { advance, createWorld } from './world';
import { buildStarterNeighbourhood } from './scenario';
import { primaryCity } from './city';

function currentRaw(): Record<string, any> {
  const world = createWorld();
  buildStarterNeighbourhood(world);
  advance(world, 40);
  return JSON.parse(serializeWorld(world));
}

function legacyRaw(raw: Record<string, any>, version: number): Record<string, any> {
  const { id: _id, ...flatCity } = raw.cities[0];
  const legacy = { ...raw, ...flatCity, version };
  delete legacy.cities;
  if (version === 4) delete legacy.home;
  if (version === 5 || version === 6) delete legacy.founded;
  return legacy;
}

describe('migrateSave', () => {
  test('passes a current-version save through unchanged', () => {
    const raw = currentRaw();
    expect(migrateSave(raw)).toEqual(raw);
  });

  test('refuses a save from a future version', () => {
    const raw = currentRaw();
    raw.version = CURRENT_VERSION + 1;
    expect(migrateSave(raw)).toBeNull();
  });

  test('refuses a non-integer version', () => {
    const raw = currentRaw();
    raw.version = 1.5;
    expect(migrateSave(raw)).toBeNull();
  });
});

describe('cities from before the archipelago', () => {
  test('every earlier version is refused rather than dropped onto ground that moved', () => {
    for (const version of [1, 2, 3]) {
      const raw = currentRaw();
      raw.version = version;
      expect(migrateSave(raw)).toBeNull();
      expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
    }
  });

  test('a refused save leaves nothing half-loaded to act on', () => {
    const raw = currentRaw();
    raw.version = 3;
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
    expect(deserializeWorld(serializeWorld(createWorld()))).not.toBeNull();
  });
});

describe('v4-v7 saves migrate their one city into world.cities', () => {
  test('every City field lands in cities[0] unchanged; shared clock, allocator, entities and wildlife are untouched', () => {
    const raw = currentRaw();
    for (const version of [4, 5, 6, 7]) {
      const migrated = migrateSave(legacyRaw(raw, version))!;
      expect(migrated).not.toBeNull();
      expect(migrated.cities).toEqual([raw.cities[0]]);
      const { cities: _migratedCities, version: _migratedVersion, ...migratedShared } = migrated;
      const { cities: _rawCities, version: _rawVersion, ...rawShared } = raw;
      expect(migratedShared).toEqual(rawShared);
    }
  });

  test('a matching deserialized world preserves every City field and the shared clock, allocator, entities and wildlife exactly', () => {
    const world = createWorld(2);
    expect(buildStarterNeighbourhood(world).ok).toBe(true);
    advance(world, 60);
    const raw = JSON.parse(serializeWorld(world));
    for (const version of [4, 5, 6, 7]) {
      const loaded = deserializeWorld(JSON.stringify(legacyRaw(raw, version)));
      expect(loaded).toEqual(world);
      const city = primaryCity(loaded!);
      const original = primaryCity(world);
      expect(city.home).toBe(original.home);
      expect(city.founded).toBe(original.founded);
      expect(city.money).toBe(original.money);
      expect(city.harbour).toEqual(original.harbour);
      expect(city.produced).toBe(original.produced);
      expect(city.delivered).toBe(original.delivered);
      expect(loaded!.time).toBe(world.time);
      expect(loaded!.remainder).toBe(world.remainder);
      expect(loaded!.nextId).toBe(world.nextId);
      expect(loaded!.roads).toEqual(world.roads);
      expect(loaded!.buildings).toEqual(world.buildings);
      expect(loaded!.walkers).toEqual(world.walkers);
      expect(loaded!.wildlife).toEqual(world.wildlife);
      expect(loaded!.felled).toEqual(world.felled);
      expect(loaded!.regrowth).toBe(world.regrowth);
    }
  });
});

describe('a save holds exactly one city', () => {
  test('rejects a save with no cities at all', () => {
    const raw = currentRaw();
    raw.cities = [];
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a save with more than one city rather than picking the first', () => {
    const raw = currentRaw();
    raw.cities = [raw.cities[0], { ...raw.cities[0], id: raw.cities[0].id + 1 }];
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });
});

describe('never silently accepting corrupted fields', () => {
  test('a present but invalid regrowth is rejected, not defaulted', () => {
    const raw = currentRaw();
    raw.regrowth = 'soon';
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('a present but invalid walker working timer is rejected, not defaulted', () => {
    const raw = currentRaw();
    if (raw.walkers.length === 0) return;
    raw.walkers[0].working = 'a while';
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('a building using the pre-stores stock field is rejected, not reinterpreted', () => {
    const raw = currentRaw();
    if (raw.buildings.length === 0) return;
    delete raw.buildings[0].stores;
    raw.buildings[0].stock = 40;
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('an unsupported island is rejected whatever its version', () => {
    const raw = currentRaw();
    raw.island = 'thalassa';
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });
});
