import { describe, expect, test } from 'bun:test';
import { deserializeWorld, serializeWorld } from './save';
import { CURRENT_VERSION, migrateSave } from './save-migrations';
import { advance, createWorld } from './world';
import { buildStarterNeighbourhood } from './scenario';

function currentRaw(): Record<string, any> {
  const world = createWorld();
  buildStarterNeighbourhood(world);
  advance(world, 40);
  return JSON.parse(serializeWorld(world));
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
