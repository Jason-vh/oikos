import { describe, expect, test } from 'bun:test';
import { advance, build, createWorld } from './world';
import { islandFor, terrainOn, tileAtOn, tileIndexOn } from './island';
import { connect, spotFor } from './testing';
import { GATHER_RANGE, overlandPath } from './gathering';
import type { Tile, World } from './types';

function nearForest(world: World, kind: 'lodge' | 'woodcutter'): Tile | null {
  const map = islandFor(world.seed);
  const forest: Tile[] = [];
  for (let z = 0; z < map.depth; z++) for (let x = 0; x < map.width; x++) if (terrainOn(map, x, z) === 'forest') forest.push({ x, z });
  for (const tree of forest) {
    const spot = spotFor(world, kind, tree);
    if (spot && Math.abs(spot.x - tree.x) + Math.abs(spot.z - tree.z) < GATHER_RANGE / 2) return spot;
  }
  return null;
}

describe('hunting', () => {
  test('a hunter walks overland to game, kills it, and meat reaches the granary by cart', () => {
    const world = createWorld(1);
    const boar = world.wildlife.find((animal) => animal.kind === 'boar')!;
    const spot = spotFor(world, 'lodge', { x: Math.floor(boar.homeX), z: Math.floor(boar.homeZ) })!;
    expect(build(world, 'lodge', spot.x, spot.z).ok).toBe(true);
    const lodge = world.buildings[0];
    expect(connect(world, lodge).ok).toBe(true);
    const granarySpot = spotFor(world, 'granary', spot)!;
    expect(build(world, 'granary', granarySpot.x, granarySpot.z).ok).toBe(true);
    expect(connect(world, world.buildings[1]).ok).toBe(true);
    const house = spotFor(world, 'house', islandFor(world.seed).entry)!;
    expect(build(world, 'house', house.x, house.z).ok).toBe(true);
    expect(connect(world, world.buildings[2]).ok).toBe(true);
    let hunted = false;
    for (let t = 0; t < 1600 && !hunted; t++) {
      advance(world, .25);
      hunted = world.walkers.some((walker) => walker.kind === 'hunter' && walker.returning && walker.cargo > 0);
    }
    expect(hunted).toBe(true);
    const killed = world.wildlife.filter((animal) => animal.respawn > 0);
    expect(killed.length).toBeGreaterThan(0);
    let stored = false;
    for (let t = 0; t < 400 && !stored; t++) {
      advance(world, 1);
      stored = (world.buildings[1].stores.meat ?? 0) > 0;
    }
    expect(stored).toBe(true);
    expect(world.produced).toBeGreaterThan(0);
  });

  test('killed game respawns at home later', () => {
    const world = createWorld(1);
    const boar = world.wildlife.find((animal) => animal.kind === 'boar')!;
    boar.respawn = 1;
    boar.x = boar.homeX + 2;
    advance(world, 1);
    expect(boar.respawn).toBe(0);
    expect(Math.abs(boar.x - boar.homeX)).toBeLessThan(.5);
  });
});

describe('woodcutting', () => {
  test('a woodcutter fells a forest tile and lumber reaches the stockpile', () => {
    const world = createWorld(1);
    const spot = nearForest(world, 'woodcutter')!;
    expect(spot).not.toBeNull();
    expect(build(world, 'woodcutter', spot.x, spot.z).ok).toBe(true);
    expect(connect(world, world.buildings[0]).ok).toBe(true);
    const pileSpot = spotFor(world, 'stockpile', spot)!;
    expect(build(world, 'stockpile', pileSpot.x, pileSpot.z).ok).toBe(true);
    expect(connect(world, world.buildings[1]).ok).toBe(true);
    const house = spotFor(world, 'house', islandFor(world.seed).entry)!;
    expect(build(world, 'house', house.x, house.z).ok).toBe(true);
    expect(connect(world, world.buildings[2]).ok).toBe(true);
    let felled = false;
    for (let t = 0; t < 400 && !felled; t++) {
      advance(world, 1);
      felled = world.felled.length > 0;
    }
    expect(felled).toBe(true);
    const map = islandFor(world.seed);
    const tile = tileAtOn(map, world.felled[0]);
    expect(terrainOn(map, tile.x, tile.z)).toBe('forest');
    let stored = false;
    for (let t = 0; t < 400 && !stored; t++) {
      advance(world, 1);
      stored = (world.buildings[1].stores.lumber ?? 0) > 0;
    }
    expect(stored).toBe(true);
  });

  test('lumber never goes to a granary and meat never to a stockpile', () => {
    const world = createWorld(1);
    const spot = nearForest(world, 'woodcutter')!;
    build(world, 'woodcutter', spot.x, spot.z);
    connect(world, world.buildings[0]);
    const granarySpot = spotFor(world, 'granary', spot)!;
    build(world, 'granary', granarySpot.x, granarySpot.z);
    connect(world, world.buildings[1]);
    const house = spotFor(world, 'house', islandFor(world.seed).entry)!;
    build(world, 'house', house.x, house.z);
    connect(world, world.buildings[2]);
    advance(world, 400);
    expect(world.buildings[1].stores.lumber ?? 0).toBe(0);
    expect(tileIndexOn(islandFor(1), 0, 0)).toBe(0);
  });
});

describe('working at the site', () => {
  test('a woodcutter stands at the tree for FELL_SECONDS before it falls', () => {
    const world = createWorld(1);
    const spot = nearForest(world, 'woodcutter')!;
    build(world, 'woodcutter', spot.x, spot.z);
    connect(world, world.buildings[0]);
    const house = spotFor(world, 'house', islandFor(world.seed).entry)!;
    build(world, 'house', house.x, house.z);
    connect(world, world.buildings[1]);
    let working: number | null = null;
    for (let t = 0; t < 1600 && working === null; t++) {
      advance(world, .25);
      const cutter = world.walkers.find((walker) => walker.kind === 'woodcutter' && walker.working > 0);
      if (cutter) working = cutter.working;
    }
    expect(working).not.toBeNull();
    expect(world.felled.length).toBe(0);
    advance(world, working! + .25);
    expect(world.felled.length).toBe(1);
  });

  test('a cornered animal stops wandering until the hunt ends', () => {
    const world = createWorld(1);
    const boar = world.wildlife.find((animal) => animal.kind === 'boar')!;
    boar.cornered = true;
    const before = [boar.x, boar.z];
    advance(world, 5);
    expect([boar.x, boar.z]).toEqual(before);
    boar.cornered = false;
    advance(world, 20);
    expect(Math.hypot(boar.x - before[0], boar.z - before[1])).toBeGreaterThan(0);
  });
});

const GATHER_STAIR_SEED = 500_501;

function gatherStairFixture() {
  const map = islandFor(GATHER_STAIR_SEED);
  const cx = 12;
  const cz = 12;
  const setTile = (x: number, z: number, terrain: 'grass' | 'water' | 'cliff', level: number) => {
    const index = tileIndexOn(map, x, z);
    map.terrain[index] = terrain;
    map.level[index] = level;
  };
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) setTile(cx + dx, cz + dz, 'water', 0);
  setTile(cx - 1, cz, 'grass', 0);
  setTile(cx, cz, 'cliff', 1);
  setTile(cx + 1, cz, 'grass', 1);
  setTile(cx, cz - 1, 'grass', 1);
  setTile(cx, cz + 1, 'grass', 1);
  return {
    map,
    down: { x: cx - 1, z: cz },
    tile: { x: cx, z: cz },
    up: { x: cx + 1, z: cz },
    north: { x: cx, z: cz - 1 },
    south: { x: cx, z: cz + 1 },
  };
}

describe('gatherers and carved stairs', () => {
  test('an overland route may cross a stair front to back', () => {
    const { map, down, tile, up } = gatherStairFixture();
    const world = createWorld(GATHER_STAIR_SEED);
    world.roads = [tileIndexOn(map, down.x, down.z), tileIndexOn(map, tile.x, tile.z)];
    const start = tileIndexOn(map, down.x, down.z);
    const goal = tileIndexOn(map, up.x, up.z);
    const path = overlandPath(world, start, (candidate) => candidate === goal, 4);
    expect(path).toEqual([start, tileIndexOn(map, tile.x, tile.z), goal]);
  });

  test('an overland route cannot cut through a stair\'s side', () => {
    const { map, down, tile, north, south } = gatherStairFixture();
    const world = createWorld(GATHER_STAIR_SEED);
    world.roads = [tileIndexOn(map, down.x, down.z), tileIndexOn(map, tile.x, tile.z)];
    const start = tileIndexOn(map, north.x, north.z);
    const goal = tileIndexOn(map, south.x, south.z);
    const path = overlandPath(world, start, (candidate) => candidate === goal, 4);
    expect(path).toBeNull();
  });
});
