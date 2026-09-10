import { describe, expect, test } from 'bun:test';
import { deserializeWorld, serializeWorld } from './save';
import { CURRENT_VERSION, migrateSave } from './save-migrations';
import { advance, build, createWorld } from './world';
import { buildStarterNeighbourhood } from './scenario';
import { islandFor, tileIndexOn } from './island';

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

  test('refuses a legacy save on the pre-Kalliste island, whose geometry no longer exists', () => {
    const raw = currentRaw();
    raw.version = 1;
    raw.island = 'thalassa';
    expect(migrateSave(raw)).toBeNull();
  });

  test('refuses a legacy save with no seed, from before the island was generated procedurally', () => {
    const raw = currentRaw();
    raw.version = 1;
    delete raw.seed;
    expect(migrateSave(raw)).toBeNull();
  });
});

describe('legacy fixtures', () => {
  test('loads and keeps simulating a save from before wildlife, felled forest and overland gathering existed', () => {
    const raw = currentRaw();
    raw.version = 1;
    delete raw.wildlife;
    delete raw.felled;
    delete raw.regrowth;
    for (const walker of raw.walkers) {
      delete walker.overland;
      delete walker.quarry;
      delete walker.working;
    }

    const restored = deserializeWorld(JSON.stringify(raw));
    expect(restored).not.toBeNull();
    expect(restored!.version).toBe(CURRENT_VERSION);
    expect(restored!.wildlife.length).toBeGreaterThan(0);
    expect(restored!.felled).toEqual([]);
    expect(restored!.regrowth).toBe(0);
    for (const walker of restored!.walkers) {
      expect(walker.overland).toEqual([]);
      expect(walker.quarry).toBeNull();
      expect(walker.working).toBe(0);
    }
    expect(() => advance(restored!, 30)).not.toThrow();
  });

  test('loads a save from after wildlife but before hunting, woodcutting and forest regrowth existed', () => {
    const world = createWorld();
    buildStarterNeighbourhood(world);
    advance(world, 40);
    const raw = JSON.parse(serializeWorld(world));
    raw.version = 1;
    delete raw.felled;
    delete raw.regrowth;
    for (const animal of raw.wildlife) {
      delete animal.respawn;
      delete animal.cornered;
    }
    for (const walker of raw.walkers) {
      delete walker.overland;
      delete walker.quarry;
      delete walker.working;
    }

    const restored = deserializeWorld(JSON.stringify(raw));
    expect(restored).not.toBeNull();
    expect(restored!.felled).toEqual([]);
    expect(restored!.regrowth).toBe(0);
    expect(restored!.wildlife.length).toBe(world.wildlife.length);
    for (const animal of restored!.wildlife) {
      expect(animal.respawn).toBe(0);
      expect(animal.cornered).toBe(false);
    }
  });

  test('loads a save from after hunting and woodcutting but before a walker could be mid-work', () => {
    const raw = currentRaw();
    raw.version = 1;
    for (const animal of raw.wildlife) delete animal.cornered;
    for (const walker of raw.walkers) delete walker.working;

    const restored = deserializeWorld(JSON.stringify(raw));
    expect(restored).not.toBeNull();
    for (const animal of restored!.wildlife) expect(animal.cornered).toBe(false);
    for (const walker of restored!.walkers) expect(walker.working).toBe(0);
  });
});

describe('wildlife backfill for saves that genuinely predate it', () => {
  test('seeds wildlife deterministically from the validated seed when the field never existed', () => {
    const raw = currentRaw();
    raw.version = 1;
    delete raw.wildlife;

    const first = deserializeWorld(JSON.stringify(raw));
    const second = deserializeWorld(JSON.stringify(raw));
    expect(first).not.toBeNull();
    expect(first!.wildlife.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  test('allocates fresh ids from the validated nextId, colliding with nothing', () => {
    const raw = currentRaw();
    raw.version = 1;
    delete raw.wildlife;

    const restored = deserializeWorld(JSON.stringify(raw))!;
    const allIds = [...restored.buildings.map((b) => b.id), ...restored.walkers.map((w) => w.id), ...restored.wildlife.map((a) => a.id)];
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(restored.wildlife.every((animal) => animal.id > 0 && animal.id < restored.nextId)).toBe(true);
  });

  test('skips animals whose home tile is now a road or covered by a building', () => {
    const world = createWorld(1);
    const map = islandFor(1);
    const boar = world.wildlife.find((animal) => animal.kind === 'boar')!;
    const boarTile = tileIndexOn(map, Math.floor(boar.homeX), Math.floor(boar.homeZ));
    const rabbit = world.wildlife.find((animal) => animal.kind === 'rabbit' && build(world, 'maintenance', Math.floor(animal.homeX), Math.floor(animal.homeZ)).ok)!;
    const rabbitTile = tileIndexOn(map, Math.floor(rabbit.homeX), Math.floor(rabbit.homeZ));

    const raw = JSON.parse(serializeWorld(world));
    raw.version = 1;
    raw.roads.push(boarTile);
    delete raw.wildlife;

    const restored = deserializeWorld(JSON.stringify(raw));
    expect(restored).not.toBeNull();
    expect(restored!.wildlife.length).toBeGreaterThan(0);
    const tiles = restored!.wildlife.map((animal) => tileIndexOn(map, Math.floor(animal.homeX), Math.floor(animal.homeZ)));
    expect(tiles).not.toContain(boarTile);
    expect(tiles).not.toContain(rabbitTile);
  });

  test('leaves an explicit empty wildlife array on a current-version save untouched', () => {
    const raw = currentRaw();
    raw.wildlife = [];

    const restored = deserializeWorld(JSON.stringify(raw));
    expect(restored).not.toBeNull();
    expect(restored!.wildlife).toEqual([]);
  });
});

describe('never silently accepting corrupted fields', () => {
  test('a present but invalid regrowth is rejected, not defaulted', () => {
    const raw = currentRaw();
    raw.version = 1;
    delete raw.wildlife;
    delete raw.felled;
    raw.regrowth = 'soon';
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('a present but invalid walker working timer is rejected, not defaulted', () => {
    const raw = currentRaw();
    raw.version = 1;
    if (raw.walkers.length === 0) return;
    raw.walkers[0].working = 'a while';
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('a legacy building using the pre-stores stock field is rejected, not reinterpreted', () => {
    const raw = currentRaw();
    raw.version = 1;
    if (raw.buildings.length === 0) return;
    delete raw.buildings[0].stores;
    raw.buildings[0].stock = 40;
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });
});
