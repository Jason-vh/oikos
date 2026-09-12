import { describe, expect, test } from 'bun:test';
import { deserializeWorld, serializeWorld } from './save';
import { CURRENT_VERSION } from './save-migrations';
import { advance, build, createWorld } from './world';
import { buildStarterNeighbourhood } from './scenario';
import { islandFor, tileIndexOn } from './island';
import { connect, homeTiles, onHomeIsland, spotFor, slopeFixture, SLOPE_SEED } from './testing';
import { primaryCity } from './city';
import { roadStepAllowed, stairLayout } from './stairs';
import type { Walker } from './types';

function advancedWorld() {
  const world = createWorld();
  buildStarterNeighbourhood(world);
  advance(world, 40);
  return world;
}

function huntingWorld() {
  const world = createWorld(1);
  const boar = world.wildlife.find((animal) => animal.kind === 'boar' && onHomeIsland(world, Math.floor(animal.homeX), Math.floor(animal.homeZ)))!;
  const lodgeSpot = spotFor(world, 'lodge', { x: Math.floor(boar.homeX), z: Math.floor(boar.homeZ) })!;
  build(world, primaryCity(world), 'lodge', lodgeSpot.x, lodgeSpot.z);
  connect(world, primaryCity(world).buildings[0]);
  const granarySpot = spotFor(world, 'granary', lodgeSpot)!;
  build(world, primaryCity(world), 'granary', granarySpot.x, granarySpot.z);
  connect(world, primaryCity(world).buildings[1]);
  const houseSpot = spotFor(world, 'house', islandFor(world.seed).entry)!;
  build(world, primaryCity(world), 'house', houseSpot.x, houseSpot.z);
  connect(world, primaryCity(world).buildings[2]);
  return world;
}

describe('round trip', () => {
  test('serializes and deserializes to an equal world', () => {
    const world = advancedWorld();
    const raw = serializeWorld(world);
    const restored = deserializeWorld(raw);
    expect(restored).not.toBeNull();
    expect(restored).toEqual(world);
  });

  test('round trip is stable across a second cycle', () => {
    const world = advancedWorld();
    const once = deserializeWorld(serializeWorld(world))!;
    const twice = deserializeWorld(serializeWorld(once))!;
    expect(twice).toEqual(once);
  });

  test('continues identically to an unsaved world with in-flight walkers', () => {
    const world = advancedWorld();
    expect(primaryCity(world).walkers.length).toBeGreaterThan(0);

    const reloaded = deserializeWorld(serializeWorld(world))!;
    advance(world, 200);
    advance(reloaded, 200);

    expect(reloaded.time).toBe(world.time);
    expect(primaryCity(reloaded).money).toBeCloseTo(primaryCity(world).money, 6);
    expect(primaryCity(reloaded).buildings).toEqual(primaryCity(world).buildings);
    expect(primaryCity(reloaded).walkers).toEqual(primaryCity(world).walkers);
  });

  test('supports a freshly created world with no buildings', () => {
    const world = createWorld();
    const restored = deserializeWorld(serializeWorld(world));
    expect(restored).toEqual(world);
  });

  test('preserves a negative treasury', () => {
    const world = createWorld();
    primaryCity(world).money = -75;
    const restored = deserializeWorld(serializeWorld(world));
    expect(restored && primaryCity(restored).money).toBe(-75);
  });
});

describe('gathering saves', () => {
  test('a save with a lodge and stockpile round-trips', () => {
    const world = huntingWorld();
    const stockpileSpot = spotFor(world, 'stockpile', islandFor(world.seed).entry)!;
    build(world, primaryCity(world), 'stockpile', stockpileSpot.x, stockpileSpot.z);
    connect(world, primaryCity(world).buildings[3]);
    const restored = deserializeWorld(serializeWorld(world));
    expect(restored).not.toBeNull();
    expect(restored).toEqual(world);
  });

  test('a hunter walking overland to game round-trips mid-work', () => {
    const world = huntingWorld();
    let working = false;
    for (let t = 0; t < 1600 && !working; t++) {
      advance(world, .25);
      working = primaryCity(world).walkers.some((walker) => walker.kind === 'hunter' && walker.working > 0);
    }
    expect(working).toBe(true);
    const restored = deserializeWorld(serializeWorld(world));
    expect(restored).not.toBeNull();
    expect(restored).toEqual(world);

    advance(world, 200);
    advance(restored!, 200);
    expect(restored!.time).toBe(world.time);
    expect(restored!.wildlife).toEqual(world.wildlife);
  });

  test('a woodcutter carrying lumber home round-trips mid-work', () => {
    const world = createWorld(1);
    let spot = null;
    for (const tree of homeTiles(world, (map, x, z) => map.terrain[tileIndexOn(map, x, z)] === 'forest')) {
      if (spot) break;
      const candidate = spotFor(world, 'woodcutter', tree);
      if (candidate && Math.abs(candidate.x - tree.x) + Math.abs(candidate.z - tree.z) < 7) spot = candidate;
    }
    expect(spot).not.toBeNull();
    build(world, primaryCity(world), 'woodcutter', spot!.x, spot!.z);
    connect(world, primaryCity(world).buildings[0]);
    const pileSpot = spotFor(world, 'stockpile', spot!)!;
    build(world, primaryCity(world), 'stockpile', pileSpot.x, pileSpot.z);
    connect(world, primaryCity(world).buildings[1]);
    const houseSpot = spotFor(world, 'house', islandFor(world.seed).entry)!;
    build(world, primaryCity(world), 'house', houseSpot.x, houseSpot.z);
    connect(world, primaryCity(world).buildings[2]);

    let carrying = false;
    for (let t = 0; t < 1600 && !carrying; t++) {
      advance(world, .25);
      carrying = primaryCity(world).walkers.some((walker) => walker.kind === 'woodcutter' && walker.returning && walker.cargo > 0);
    }
    expect(carrying).toBe(true);
    expect(world.felled.length).toBeGreaterThan(0);
    const restored = deserializeWorld(serializeWorld(world));
    expect(restored).not.toBeNull();
    expect(restored).toEqual(world);
  });
});

describe('corruption rejection', () => {
  test('rejects invalid JSON', () => {
    expect(deserializeWorld('not json')).toBeNull();
  });

  test('rejects a future save version', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    raw.version = CURRENT_VERSION + 1;
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects an unsupported island', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    raw.island = 'atlantis';
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a building of an unknown kind', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    raw.cities[0].buildings[0].kind = 'palace';
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a non-finite number', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    raw.cities[0].money = 'a lot';
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects duplicate building ids', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    if (raw.cities[0].buildings.length < 2) return;
    raw.cities[0].buildings[1].id = raw.cities[0].buildings[0].id;
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a building id at or beyond nextId', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    raw.cities[0].buildings[0].id = raw.nextId;
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a building overlapping a road tile', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    const map = islandFor(raw.seed);
    raw.cities[0].roads.push(tileIndexOn(map, raw.cities[0].buildings[0].x, raw.cities[0].buildings[0].z));
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a seed outside the valid range', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    raw.seed = -1;
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a non-integer seed', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    raw.seed = 1.5;
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a walker with a non-adjacent path jump', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    if (raw.cities[0].walkers.length === 0) return;
    raw.cities[0].walkers[0].path = [raw.cities[0].walkers[0].path[0], 9999];
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a walker referencing a missing home building', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    if (raw.cities[0].walkers.length === 0) return;
    raw.cities[0].walkers[0].homeId = 999999;
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a vendor marked enabled but never installed', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    const agora = raw.cities[0].buildings.find((building: { kind: string }) => building.kind === 'agora');
    if (!agora) return;
    agora.vendorEnabled = true;
    agora.vendorInstalled = false;
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects out-of-range road tiles', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    raw.cities[0].roads.push(999999);
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a root that is not an object', () => {
    expect(deserializeWorld('42')).toBeNull();
    expect(deserializeWorld('[]')).toBeNull();
  });
});

const AMBIGUOUS_ORIGIN = { x: 20, z: 20 };

function ambiguousStairFixture() {
  const { low, high, landing } = slopeFixture();
  const map = islandFor(SLOPE_SEED);
  map.terrain[tileIndexOn(map, high.x, high.z)] = 'cliff';

  const setTile = (x: number, z: number, terrain: 'grass' | 'cliff', level: number) => {
    const index = tileIndexOn(map, x, z);
    map.terrain[index] = terrain;
    map.level[index] = level;
  };
  const ambiguousTile = { x: AMBIGUOUS_ORIGIN.x, z: AMBIGUOUS_ORIGIN.z };
  const eastDown = { x: AMBIGUOUS_ORIGIN.x + 1, z: AMBIGUOUS_ORIGIN.z };
  const westUp = { x: AMBIGUOUS_ORIGIN.x - 1, z: AMBIGUOUS_ORIGIN.z };
  const northDown = { x: AMBIGUOUS_ORIGIN.x, z: AMBIGUOUS_ORIGIN.z - 1 };
  const southUp = { x: AMBIGUOUS_ORIGIN.x, z: AMBIGUOUS_ORIGIN.z + 1 };
  setTile(ambiguousTile.x, ambiguousTile.z, 'cliff', 1);
  setTile(eastDown.x, eastDown.z, 'grass', 0);
  setTile(westUp.x, westUp.z, 'grass', 1);
  setTile(northDown.x, northDown.z, 'grass', 0);
  setTile(southUp.x, southUp.z, 'grass', 1);

  return { map, low, high, landing, ambiguousTile, eastDown, northDown };
}

function bareWalker(overrides: Partial<Walker> & Pick<Walker, 'id' | 'homeId' | 'path'>): Walker {
  return {
    kind: 'maintenance', targetId: null, step: 0, progress: 0, food: null, cargo: 0,
    returning: false, overland: [], quarry: null, working: 0, ...overrides,
  };
}

describe('legacy topology quarantine', () => {
  test('a legacy tile with two lower road neighbours derives no stair at all; a clean stair elsewhere is unaffected', () => {
    const { map, low, high, ambiguousTile, eastDown, northDown } = ambiguousStairFixture();
    const world = createWorld(SLOPE_SEED);
    const lowIndex = tileIndexOn(map, low.x, low.z);
    const highIndex = tileIndexOn(map, high.x, high.z);
    const ambiguousIndex = tileIndexOn(map, ambiguousTile.x, ambiguousTile.z);
    const eastDownIndex = tileIndexOn(map, eastDown.x, eastDown.z);
    const northDownIndex = tileIndexOn(map, northDown.x, northDown.z);
    primaryCity(world).roads = [...primaryCity(world).roads, lowIndex, highIndex, ambiguousIndex, eastDownIndex, northDownIndex];

    const restored = deserializeWorld(serializeWorld(world));
    expect(restored).not.toBeNull();
    expect([...primaryCity(restored!).roads].sort((a, b) => a - b)).toEqual([...primaryCity(world).roads].sort((a, b) => a - b));

    const stairs = stairLayout(map, new Set(primaryCity(restored!).roads));
    expect(stairs.get(highIndex)?.down).toBe(lowIndex);
    expect(stairs.has(ambiguousIndex)).toBe(false);
    expect(roadStepAllowed(map, stairs, ambiguousIndex, eastDownIndex)).toBe(false);
    expect(roadStepAllowed(map, stairs, ambiguousIndex, northDownIndex)).toBe(false);
  });

  test('walkers crossing an ambiguous legacy tile from either side are dropped; a walker on a clean stair elsewhere round-trips', () => {
    const { map, low, high, ambiguousTile, eastDown, northDown } = ambiguousStairFixture();
    const world = createWorld(SLOPE_SEED);
    const lowIndex = tileIndexOn(map, low.x, low.z);
    const highIndex = tileIndexOn(map, high.x, high.z);
    const ambiguousIndex = tileIndexOn(map, ambiguousTile.x, ambiguousTile.z);
    const eastDownIndex = tileIndexOn(map, eastDown.x, eastDown.z);
    const northDownIndex = tileIndexOn(map, northDown.x, northDown.z);
    primaryCity(world).roads = [...primaryCity(world).roads, lowIndex, highIndex, ambiguousIndex, eastDownIndex, northDownIndex];

    const spot = spotFor(world, 'maintenance', low)!;
    build(world, primaryCity(world), 'maintenance', spot.x, spot.z);
    const home = primaryCity(world).buildings[0];

    const eastWalker = bareWalker({ id: world.nextId++, homeId: home.id, path: [eastDownIndex, ambiguousIndex] });
    const northWalker = bareWalker({ id: world.nextId++, homeId: home.id, path: [northDownIndex, ambiguousIndex] });
    const validWalker = bareWalker({ id: world.nextId++, homeId: home.id, path: [lowIndex, highIndex] });
    primaryCity(world).walkers.push(eastWalker, northWalker, validWalker);

    const restored = deserializeWorld(serializeWorld(world));
    expect(restored).not.toBeNull();
    expect(primaryCity(restored!).walkers.map((walker) => walker.id)).toEqual([validWalker.id]);
    expect([...primaryCity(restored!).roads].sort((a, b) => a - b)).toEqual([...primaryCity(world).roads].sort((a, b) => a - b));
  });

  test('dropping a stranded hunter releases its cornered quarry', () => {
    const { low, high, ambiguousTile, eastDown, northDown } = ambiguousStairFixture();
    const world = createWorld(SLOPE_SEED);
    const map = islandFor(SLOPE_SEED);
    const lowIndex = tileIndexOn(map, low.x, low.z);
    const highIndex = tileIndexOn(map, high.x, high.z);
    const ambiguousIndex = tileIndexOn(map, ambiguousTile.x, ambiguousTile.z);
    const eastDownIndex = tileIndexOn(map, eastDown.x, eastDown.z);
    const northDownIndex = tileIndexOn(map, northDown.x, northDown.z);
    primaryCity(world).roads = [...primaryCity(world).roads, lowIndex, highIndex, ambiguousIndex, eastDownIndex, northDownIndex];

    const spot = spotFor(world, 'lodge', low)!;
    build(world, primaryCity(world), 'lodge', spot.x, spot.z);
    const lodge = primaryCity(world).buildings[0];
    const boar = world.wildlife.find((animal) => animal.kind === 'boar' && onHomeIsland(world, Math.floor(animal.homeX), Math.floor(animal.homeZ)))!;
    boar.cornered = true;

    const strandedHunter = bareWalker({
      id: world.nextId++, kind: 'hunter', homeId: lodge.id, path: [northDownIndex, ambiguousIndex], quarry: boar.id, working: 1,
    });
    primaryCity(world).walkers.push(strandedHunter);

    const restored = deserializeWorld(serializeWorld(world));
    expect(restored).not.toBeNull();
    expect(primaryCity(restored!).walkers).toHaveLength(0);
    const restoredBoar = restored!.wildlife.find((animal) => animal.id === boar.id)!;
    expect(restoredBoar.cornered).toBe(false);
  });
});
