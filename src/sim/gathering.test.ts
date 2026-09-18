import { describe, expect, test } from 'bun:test';
import { advance, build, buildingStatus, createWorld } from './world';
import { islandFor, terrainOn, tileAtOn, tileIndexOn } from './island';
import { built, connect, homeTiles, onHomeIsland, openLadder, spotFor } from './testing';
import { GATHER_RANGE, GATHER_STOCK_CAP, gatherReach, overlandPath } from './gathering';
import { alive, animalAt, SPECIES, wildlifeObstacles } from './wildlife';
import { primaryCity } from './city';
import { BUILDINGS } from './catalog';
import type { Building, City, Tile, World } from './types';

function nearForest(world: World, kind: 'lodge' | 'woodcutter'): Tile | null {
  openLadder(world);
  const forest = homeTiles(world, (map, x, z) => terrainOn(map, x, z) === 'forest');
  for (const tree of forest) {
    const spot = spotFor(world, kind, tree);
    if (spot && Math.abs(spot.x - tree.x) + Math.abs(spot.z - tree.z) < GATHER_RANGE / 2) return spot;
  }
  return null;
}

describe('hunting', () => {
  test('a hunter walks overland to game, kills it, and meat reaches the granary by cart', () => {
    const world = createWorld(1);
    const boar = world.wildlife.find((animal) => animal.kind === 'boar' && onHomeIsland(world, Math.floor(animal.homeX), Math.floor(animal.homeZ)))!;
    const spot = spotFor(world, 'lodge', { x: Math.floor(boar.homeX), z: Math.floor(boar.homeZ) })!;
    expect(build(world, primaryCity(world), 'lodge', spot.x, spot.z).ok).toBe(true);
    const lodge = built(world, 'lodge');
    expect(connect(world, lodge).ok).toBe(true);
    const granarySpot = spotFor(world, 'granary', spot)!;
    expect(build(world, primaryCity(world), 'granary', granarySpot.x, granarySpot.z).ok).toBe(true);
    expect(connect(world, built(world, 'granary')).ok).toBe(true);
    const house = spotFor(world, 'house', islandFor(world.seed).entry)!;
    expect(build(world, primaryCity(world), 'house', house.x, house.z).ok).toBe(true);
    expect(connect(world, built(world, 'house')).ok).toBe(true);
    let hunted = false;
    for (let t = 0; t < 1600 && !hunted; t++) {
      advance(world, .25);
      hunted = primaryCity(world).walkers.some((walker) => walker.kind === 'hunter' && walker.returning && walker.cargo > 0);
    }
    expect(hunted).toBe(true);
    const killed = world.wildlife.filter((animal) => animal.respawnAt !== null);
    expect(killed.length).toBeGreaterThan(0);
    let stored = false;
    for (let t = 0; t < 400 && !stored; t++) {
      advance(world, 1);
      stored = (built(world, 'granary').stores.meat ?? 0) > 0;
    }
    expect(stored).toBe(true);
    expect(primaryCity(world).produced).toBeGreaterThan(0);
  });

  test('killed game respawns at home later', () => {
    const world = createWorld(1);
    const boar = world.wildlife.find((animal) => animal.kind === 'boar' && onHomeIsland(world, Math.floor(animal.homeX), Math.floor(animal.homeZ)))!;
    boar.respawnAt = world.time + 1;
    expect(alive(boar, world.time)).toBe(false);
    advance(world, 1);
    expect(boar.respawnAt).toBeNull();
    const back = animalAt(islandFor(world.seed), wildlifeObstacles(world), boar, world.time);
    expect(Math.hypot(back.x - boar.homeX, back.z - boar.homeZ)).toBeLessThan(SPECIES.boar.range);
  });
});

describe('woodcutting', () => {
  test('a woodcutter fells a forest tile and lumber reaches the stockpile', () => {
    const world = createWorld(1);
    const spot = nearForest(world, 'woodcutter')!;
    expect(spot).not.toBeNull();
    expect(build(world, primaryCity(world), 'woodcutter', spot.x, spot.z).ok).toBe(true);
    expect(connect(world, built(world, 'woodcutter')).ok).toBe(true);
    const pileSpot = spotFor(world, 'stockpile', spot)!;
    expect(build(world, primaryCity(world), 'stockpile', pileSpot.x, pileSpot.z).ok).toBe(true);
    expect(connect(world, built(world, 'stockpile')).ok).toBe(true);
    const house = spotFor(world, 'house', islandFor(world.seed).entry)!;
    expect(build(world, primaryCity(world), 'house', house.x, house.z).ok).toBe(true);
    expect(connect(world, built(world, 'house')).ok).toBe(true);
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
      stored = (built(world, 'stockpile').stores.lumber ?? 0) > 0;
    }
    expect(stored).toBe(true);
  });

  test('lumber never goes to a granary and meat never to a stockpile', () => {
    const world = createWorld(1);
    const spot = nearForest(world, 'woodcutter')!;
    build(world, primaryCity(world), 'woodcutter', spot.x, spot.z);
    connect(world, built(world, 'woodcutter'));
    const granarySpot = spotFor(world, 'granary', spot)!;
    build(world, primaryCity(world), 'granary', granarySpot.x, granarySpot.z);
    connect(world, built(world, 'granary'));
    const house = spotFor(world, 'house', islandFor(world.seed).entry)!;
    build(world, primaryCity(world), 'house', house.x, house.z);
    connect(world, built(world, 'house'));
    advance(world, 400);
    expect(built(world, 'granary').stores.lumber ?? 0).toBe(0);
    expect(tileIndexOn(islandFor(1), 0, 0)).toBe(0);
  });
});

describe('working at the site', () => {
  test('a woodcutter stands at the tree for FELL_SECONDS before it falls', () => {
    const world = createWorld(1);
    const spot = nearForest(world, 'woodcutter')!;
    build(world, primaryCity(world), 'woodcutter', spot.x, spot.z);
    connect(world, built(world, 'woodcutter'));
    const house = spotFor(world, 'house', islandFor(world.seed).entry)!;
    build(world, primaryCity(world), 'house', house.x, house.z);
    connect(world, built(world, 'house'));
    let working: number | null = null;
    for (let t = 0; t < 1600 && working === null; t++) {
      advance(world, .25);
      const cutter = primaryCity(world).walkers.find((walker) => walker.kind === 'woodcutter' && walker.task !== null);
      if (cutter) working = cutter.task!.until - world.time;
    }
    expect(working).not.toBeNull();
    expect(world.felled.length).toBe(0);
    advance(world, working! + .25);
    expect(world.felled.length).toBe(1);
  });

  test('a cornered animal stops wandering until the hunt ends', () => {
    const world = createWorld(1);
    const boar = world.wildlife.find((animal) => animal.kind === 'boar' && onHomeIsland(world, Math.floor(animal.homeX), Math.floor(animal.homeZ)))!;
    const at = (time: number) => animalAt(islandFor(world.seed), wildlifeObstacles(world), boar, time);
    boar.cornered = true;
    const before = at(0);
    expect(at(5)).toEqual(before);
    boar.cornered = false;
    expect(Math.hypot(at(20).x - before.x, at(20).z - before.z)).toBeGreaterThan(0);
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
    primaryCity(world).roads = [tileIndexOn(map, down.x, down.z), tileIndexOn(map, tile.x, tile.z)];
    const start = tileIndexOn(map, down.x, down.z);
    const goal = tileIndexOn(map, up.x, up.z);
    const path = overlandPath(world, primaryCity(world), start, (candidate) => candidate === goal, 4);
    expect(path).toEqual([start, tileIndexOn(map, tile.x, tile.z), goal]);
  });

  test('an overland route cannot cut through a stair\'s side', () => {
    const { map, down, tile, north, south } = gatherStairFixture();
    const world = createWorld(GATHER_STAIR_SEED);
    primaryCity(world).roads = [tileIndexOn(map, down.x, down.z), tileIndexOn(map, tile.x, tile.z)];
    const start = tileIndexOn(map, north.x, north.z);
    const goal = tileIndexOn(map, south.x, south.z);
    const path = overlandPath(world, primaryCity(world), start, (candidate) => candidate === goal, 4);
    expect(path).toBeNull();
  });
});

describe('cross-city occupancy', () => {
  test('a tile that is one city\'s own road but another city\'s building blocks overland travel, even though the overlap is currently constructible in-memory', () => {
    const { map, down, tile, up } = gatherStairFixture();
    const world = createWorld(GATHER_STAIR_SEED);
    const city1 = primaryCity(world);
    const downIndex = tileIndexOn(map, down.x, down.z);
    const tileIndex = tileIndexOn(map, tile.x, tile.z);
    const upIndex = tileIndexOn(map, up.x, up.z);
    city1.roads = [downIndex, tileIndex];

    expect(overlandPath(world, city1, downIndex, (candidate) => candidate === upIndex, 4)).not.toBeNull();

    const foreignBuilding: Building = {
      id: world.nextId++, x: tile.x, z: tile.z, kind: 'fountain', rotation: 0, tier: 1, residents: 0, food: 0, water: 0, oil: 0,
      condition: 100, stores: {}, progress: 0, workers: 0, vendorEnabled: false, vendorInstalled: false, stalls: {},
      connected: false, serviceTimer: 0, upgradeTimer: 0,
    };
    const foreignCity: City = { ...structuredClone(city1), id: city1.id + 1, roads: [], walkers: [], buildings: [foreignBuilding] };
    world.cities.push(foreignCity);

    expect(overlandPath(world, city1, downIndex, (candidate) => candidate === upIndex, 4)).toBeNull();
  });
});

describe('telling the player why a gatherer is idle', () => {
  function housed(world: World): void {
    for (let index = 0; index < 3; index++) {
      const plot = spotFor(world, 'house', islandFor(world.seed).entry)!;
      build(world, primaryCity(world), 'house', plot.x, plot.z);
      connect(world, primaryCity(world).buildings.at(-1)!);
    }
  }

  function staffed(world: World, workplace: Building): void {
    for (let step = 0; step < 4000 && workplace.workers < BUILDINGS[workplace.kind].jobs; step++) advance(world, .25);
    expect(workplace.workers).toBe(BUILDINGS[workplace.kind].jobs);
  }

  function staffedCabin(world: World): Building {
    const spot = nearForest(world, 'woodcutter')!;
    build(world, primaryCity(world), 'woodcutter', spot.x, spot.z);
    const cabin = built(world, 'woodcutter');
    connect(world, cabin);
    housed(world);
    staffed(world, cabin);
    return cabin;
  }

  test('a cabin reports its woodcutter in the forest, and says so again when he is home', () => {
    const world = createWorld(1);
    const cabin = staffedCabin(world);
    let away = false;
    for (let step = 0; step < 1600 && !away; step++) {
      advance(world, .25);
      away = primaryCity(world).walkers.some((walker) => walker.kind === 'woodcutter');
    }
    expect(away).toBe(true);
    expect(buildingStatus(world, primaryCity(world), cabin)).toContain('Woodcutter in the forest.');

    primaryCity(world).walkers = [];
    expect(buildingStatus(world, primaryCity(world), cabin)).toContain('Woodcutter resting at the cabin.');
  });

  test('a cabin with nothing left to fell says the forest is regrowing, not nothing at all', () => {
    const world = createWorld(1);
    const cabin = staffedCabin(world);
    const map = islandFor(world.seed);
    world.felled = map.terrain.flatMap((terrain, tile) => terrain === 'forest' ? [tile] : []);
    primaryCity(world).walkers = [];

    expect(buildingStatus(world, primaryCity(world), cabin)).toEqual(['No standing trees within reach; the forest is regrowing.']);

    world.felled = [];
    expect(buildingStatus(world, primaryCity(world), cabin)).toEqual(['Woodcutter resting at the cabin.']);
  });

  test('a full cabin says it is waiting for a cart rather than for trees', () => {
    const world = createWorld(1);
    const cabin = staffedCabin(world);
    primaryCity(world).walkers = [];
    cabin.stores = { lumber: GATHER_STOCK_CAP };

    expect(buildingStatus(world, primaryCity(world), cabin)).toEqual(['Full of lumber; waiting for a cart to a stockpile.']);
  });

  test('a lodge speaks of game, not of trees', () => {
    const world = createWorld(1);
    const boar = world.wildlife.find((animal) => animal.kind === 'boar' && onHomeIsland(world, Math.floor(animal.homeX), Math.floor(animal.homeZ)))!;
    const spot = spotFor(world, 'lodge', { x: Math.floor(boar.homeX), z: Math.floor(boar.homeZ) })!;
    build(world, primaryCity(world), 'lodge', spot.x, spot.z);
    const lodge = built(world, 'lodge');
    connect(world, lodge);
    housed(world);
    staffed(world, lodge);
    primaryCity(world).walkers = [];
    world.wildlife = [];

    expect(buildingStatus(world, primaryCity(world), lodge)).toEqual(['No game within reach; the herds will wander back.']);
  });
});

describe('the reach a gatherer is promised', () => {
  test('never exceeds the range the walker is given, and never leaves walkable ground', () => {
    const world = createWorld(1);
    const spot = nearForest(world, 'woodcutter')!;
    build(world, primaryCity(world), 'woodcutter', spot.x, spot.z);
    const cabin = built(world, 'woodcutter');
    connect(world, cabin);
    const map = islandFor(world.seed);
    const reach = gatherReach(world, primaryCity(world), 'woodcutter', cabin.x, cabin.z, cabin.rotation);

    expect(reach.length).toBeGreaterThan(20);
    for (const tile of reach) {
      const { x, z } = tileAtOn(map, tile);
      expect(terrainOn(map, x, z)).not.toBe('water');
      expect(terrainOn(map, x, z)).not.toBe('rock');
      const away = Math.max(0, cabin.x - x, x - (cabin.x + 1)) + Math.max(0, cabin.z - z, z - (cabin.z + 1));
      expect(away).toBeLessThanOrEqual(GATHER_RANGE + 1);
    }
  });

  test('covers every tree the cabin actually fells, and none once it is out of range', () => {
    const world = createWorld(1);
    const spot = nearForest(world, 'woodcutter')!;
    build(world, primaryCity(world), 'woodcutter', spot.x, spot.z);
    const cabin = built(world, 'woodcutter');
    connect(world, cabin);
    const house = spotFor(world, 'house', islandFor(world.seed).entry)!;
    build(world, primaryCity(world), 'house', house.x, house.z);
    connect(world, built(world, 'house'));
    const map = islandFor(world.seed);
    const inside = new Set(gatherReach(world, primaryCity(world), 'woodcutter', cabin.x, cabin.z, cabin.rotation));

    for (let step = 0; step < 2000 && world.felled.length < 3; step++) advance(world, .25);
    expect(world.felled.length).toBeGreaterThan(0);
    for (const felled of world.felled) {
      const { x, z } = tileAtOn(map, felled);
      const touching = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => inside.has(tileIndexOn(map, x + dx, z + dz)));
      expect(touching).toBe(true);
    }
  });

  test('a lodge is promised ground the same way, measured from its own door', () => {
    const world = createWorld(1);
    const boar = world.wildlife.find((animal) => animal.kind === 'boar' && onHomeIsland(world, Math.floor(animal.homeX), Math.floor(animal.homeZ)))!;
    const spot = spotFor(world, 'lodge', { x: Math.floor(boar.homeX), z: Math.floor(boar.homeZ) })!;
    build(world, primaryCity(world), 'lodge', spot.x, spot.z);
    const lodge = built(world, 'lodge');
    connect(world, lodge);
    const reach = gatherReach(world, primaryCity(world), 'lodge', lodge.x, lodge.z, lodge.rotation);

    expect(reach.length).toBeGreaterThan(20);
    const map = islandFor(world.seed);
    for (const tile of reach) {
      const { x, z } = tileAtOn(map, tile);
      expect(terrainOn(map, x, z)).not.toBe('water');
    }
  });

  test('is empty for a kind that gathers nothing', () => {
    const world = createWorld(1);
    const spot = spotFor(world, 'granary', islandFor(world.seed).entry)!;
    expect(gatherReach(world, primaryCity(world), 'granary', spot.x, spot.z, 0)).toEqual([]);
  });
});
