import { describe, expect, test } from 'bun:test';
import { deserializeWorld, serializeWorld } from './save';
import { advance, build, createWorld } from './world';
import { buildStarterNeighbourhood } from './scenario';
import { islandFor, tileIndexOn } from './island';
import { connect, spotFor } from './testing';

function advancedWorld() {
  const world = createWorld();
  buildStarterNeighbourhood(world);
  advance(world, 40);
  return world;
}

function huntingWorld() {
  const world = createWorld(1);
  const boar = world.wildlife.find((animal) => animal.kind === 'boar')!;
  const lodgeSpot = spotFor(world, 'lodge', { x: Math.floor(boar.homeX), z: Math.floor(boar.homeZ) })!;
  build(world, 'lodge', lodgeSpot.x, lodgeSpot.z);
  connect(world, world.buildings[0]);
  const granarySpot = spotFor(world, 'granary', lodgeSpot)!;
  build(world, 'granary', granarySpot.x, granarySpot.z);
  connect(world, world.buildings[1]);
  const houseSpot = spotFor(world, 'house', islandFor(world.seed).entry)!;
  build(world, 'house', houseSpot.x, houseSpot.z);
  connect(world, world.buildings[2]);
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
    expect(world.walkers.length).toBeGreaterThan(0);

    const reloaded = deserializeWorld(serializeWorld(world))!;
    advance(world, 200);
    advance(reloaded, 200);

    expect(reloaded.time).toBe(world.time);
    expect(reloaded.money).toBeCloseTo(world.money, 6);
    expect(reloaded.buildings).toEqual(world.buildings);
    expect(reloaded.walkers).toEqual(world.walkers);
  });

  test('supports a freshly created world with no buildings', () => {
    const world = createWorld();
    const restored = deserializeWorld(serializeWorld(world));
    expect(restored).toEqual(world);
  });

  test('preserves a negative treasury', () => {
    const world = createWorld();
    world.money = -75;
    const restored = deserializeWorld(serializeWorld(world));
    expect(restored?.money).toBe(-75);
  });
});

describe('gathering saves', () => {
  test('a save with a lodge and stockpile round-trips', () => {
    const world = huntingWorld();
    const stockpileSpot = spotFor(world, 'stockpile', islandFor(world.seed).entry)!;
    build(world, 'stockpile', stockpileSpot.x, stockpileSpot.z);
    connect(world, world.buildings[3]);
    const restored = deserializeWorld(serializeWorld(world));
    expect(restored).not.toBeNull();
    expect(restored).toEqual(world);
  });

  test('a hunter walking overland to game round-trips mid-work', () => {
    const world = huntingWorld();
    let working = false;
    for (let t = 0; t < 1600 && !working; t++) {
      advance(world, .25);
      working = world.walkers.some((walker) => walker.kind === 'hunter' && walker.working > 0);
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
    const map = islandFor(world.seed);
    let spot = null;
    for (let z = 0; z < map.depth && !spot; z++) {
      for (let x = 0; x < map.width && !spot; x++) {
        if (map.terrain[tileIndexOn(map, x, z)] !== 'forest') continue;
        const candidate = spotFor(world, 'woodcutter', { x, z });
        if (candidate && Math.abs(candidate.x - x) + Math.abs(candidate.z - z) < 7) spot = candidate;
      }
    }
    expect(spot).not.toBeNull();
    build(world, 'woodcutter', spot!.x, spot!.z);
    connect(world, world.buildings[0]);
    const pileSpot = spotFor(world, 'stockpile', spot!)!;
    build(world, 'stockpile', pileSpot.x, pileSpot.z);
    connect(world, world.buildings[1]);
    const houseSpot = spotFor(world, 'house', map.entry)!;
    build(world, 'house', houseSpot.x, houseSpot.z);
    connect(world, world.buildings[2]);

    let carrying = false;
    for (let t = 0; t < 1600 && !carrying; t++) {
      advance(world, .25);
      carrying = world.walkers.some((walker) => walker.kind === 'woodcutter' && walker.returning && walker.cargo > 0);
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
    raw.version = 3;
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
    raw.buildings[0].kind = 'palace';
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a non-finite number', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    raw.money = 'a lot';
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects duplicate building ids', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    if (raw.buildings.length < 2) return;
    raw.buildings[1].id = raw.buildings[0].id;
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a building id at or beyond nextId', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    raw.buildings[0].id = raw.nextId;
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a building overlapping a road tile', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    const map = islandFor(raw.seed);
    raw.roads.push(tileIndexOn(map, raw.buildings[0].x, raw.buildings[0].z));
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
    if (raw.walkers.length === 0) return;
    raw.walkers[0].path = [raw.walkers[0].path[0], 9999];
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a walker referencing a missing home building', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    if (raw.walkers.length === 0) return;
    raw.walkers[0].homeId = 999999;
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a vendor marked enabled but never installed', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    const agora = raw.buildings.find((building: { kind: string }) => building.kind === 'agora');
    if (!agora) return;
    agora.vendorEnabled = true;
    agora.vendorInstalled = false;
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects out-of-range road tiles', () => {
    const world = advancedWorld();
    const raw = JSON.parse(serializeWorld(world));
    raw.roads.push(999999);
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a root that is not an object', () => {
    expect(deserializeWorld('42')).toBeNull();
    expect(deserializeWorld('[]')).toBeNull();
  });
});
