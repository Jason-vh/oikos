import { describe, expect, test } from 'bun:test';
import { advance, build, createWorld, getSummary } from './world';
import { primaryCity } from './city';
import { buildStarterNeighbourhood } from './scenario';
import { connect, homeTiles, spotFor } from './testing';
import { serializeWorld, deserializeWorld } from './save';
import { ISLAND_COUNT, islandFor, terrainOn, tileIndexOn } from './island';
import { STEP } from './balance';
import { GATHER_RANGE, REGROW_SECONDS } from './gathering';
import type { City, Tile } from './types';

function foundedTwoCityWorld(seed = 1) {
  const world = createWorld(seed, 0);
  const city1 = primaryCity(world);
  const otherHome = (city1.home + 1) % ISLAND_COUNT;
  const other = createWorld(seed, otherHome);
  const city2: City = { ...primaryCity(other), id: city1.id + 1 };
  city2.harbour = { ...city2.harbour, id: world.nextId++ };
  world.cities.push(city2);
  return { world, city1, city2 };
}

describe('two founded cities in one World', () => {
  test('each city runs its own economy independently: staffing, production, delivery, housing and finances', () => {
    const { world, city1, city2 } = foundedTwoCityWorld();
    expect(buildStarterNeighbourhood(world, city1).ok).toBe(true);
    expect(buildStarterNeighbourhood(world, city2).ok).toBe(true);
    const startingMoney1 = city1.money;
    const startingMoney2 = city2.money;

    advance(world, 180);

    expect(city1.produced).toBeGreaterThan(0);
    expect(city1.delivered).toBeGreaterThan(0);
    expect(city2.produced).toBeGreaterThan(0);
    expect(city2.delivered).toBeGreaterThan(0);

    const summary1 = getSummary(city1);
    const summary2 = getSummary(city2);
    expect(summary1.population).toBeGreaterThan(0);
    expect(summary2.population).toBeGreaterThan(0);
    expect(summary1.workers).toBeGreaterThan(0);
    expect(summary2.workers).toBeGreaterThan(0);
    expect(city1.money).not.toBe(startingMoney1);
    expect(city2.money).not.toBe(startingMoney2);

    const city1BuildingIds = new Set(city1.buildings.map((building) => building.id));
    const city2BuildingIds = new Set(city2.buildings.map((building) => building.id));
    expect(city1.buildings.every((building) => !city2BuildingIds.has(building.id))).toBe(true);
    expect(city1.walkers.length).toBeGreaterThan(0);
    expect(city2.walkers.length).toBeGreaterThan(0);

    for (const walker of city1.walkers) {
      expect(walker.homeId === city1.harbour.id || city1BuildingIds.has(walker.homeId)).toBe(true);
      if (walker.targetId !== null) expect(walker.targetId === city1.harbour.id || city1BuildingIds.has(walker.targetId)).toBe(true);
    }
    for (const walker of city2.walkers) {
      expect(walker.homeId === city2.harbour.id || city2BuildingIds.has(walker.homeId)).toBe(true);
      if (walker.targetId !== null) expect(walker.targetId === city2.harbour.id || city2BuildingIds.has(walker.targetId)).toBe(true);
    }
  });

  test('wildlife and forest regrowth step exactly once per tick, not once per founded city', () => {
    const { world } = foundedTwoCityWorld();
    world.felled = [0];
    const beforePhases = world.wildlife.map((animal) => animal.phase);
    const beforeCount = world.wildlife.length;
    const beforeTime = world.time;
    const beforeRegrowth = world.regrowth;

    advance(world, STEP);

    expect(world.wildlife.length).toBe(beforeCount);
    for (let index = 0; index < world.wildlife.length; index++) {
      expect(world.wildlife[index].phase).toBeCloseTo(beforePhases[index] + STEP, 10);
    }
    expect(world.time).toBeCloseTo(beforeTime + STEP, 10);
    expect(world.remainder).toBe(0);
    expect(world.regrowth).toBeCloseTo(beforeRegrowth + STEP, 10);
  });

  test('forest regrowth protects a felled tile occupied by any city\'s road, not only the primary city\'s', () => {
    const { world, city1, city2 } = foundedTwoCityWorld();
    const map = islandFor(world.seed);
    const thirdHome = (city1.home + 2) % ISLAND_COUNT;
    const thirdIsland = map.islands[thirdHome];
    const freeTile = tileIndexOn(map, thirdIsland.entry.x, thirdIsland.entry.z);
    const protectedTile = city2.roads[0];
    world.felled = [protectedTile, freeTile];
    world.regrowth = REGROW_SECONDS - STEP;

    advance(world, STEP);

    expect(world.felled).toEqual([protectedTile]);
    expect(world.regrowth).toBe(0);
  });

  test('a pending (unfounded) city is skipped entirely, even when it is the first city in World.cities', () => {
    const world = createWorld(1, 0);
    const founded = primaryCity(world);
    expect(buildStarterNeighbourhood(world, founded).ok).toBe(true);
    const otherHome = (founded.home + 1) % ISLAND_COUNT;
    const pendingWorld = createWorld(1, otherHome, false);
    const pending: City = { ...primaryCity(pendingWorld), id: founded.id + 1 };
    world.cities.unshift(pending);
    expect(world.cities[0]).toBe(pending);
    const snapshotPending = structuredClone(pending);

    advance(world, 120);

    expect(founded.produced).toBeGreaterThan(0);
    expect(pending).toEqual(snapshotPending);
  });

  test('an asymmetric second city with gathering and harbour buildings runs correctly under the shared multi-city tick', () => {
    const world = createWorld(1, 0);
    const city1 = primaryCity(world);
    expect(buildStarterNeighbourhood(world, city1).ok).toBe(true);

    const otherHome = (city1.home + 1) % ISLAND_COUNT;
    const other = createWorld(1, otherHome);
    const otherCity = primaryCity(other);
    expect(buildStarterNeighbourhood(other, otherCity).ok).toBe(true);

    const forest = homeTiles(other, (map, x, z) => terrainOn(map, x, z) === 'forest');
    let woodcutterSpot: Tile | null = null;
    for (const tree of forest) {
      const spot = spotFor(other, 'woodcutter', tree);
      if (spot && Math.abs(spot.x - tree.x) + Math.abs(spot.z - tree.z) < GATHER_RANGE / 2) { woodcutterSpot = spot; break; }
    }
    expect(woodcutterSpot).not.toBeNull();
    expect(build(other, otherCity, 'woodcutter', woodcutterSpot!.x, woodcutterSpot!.z).ok).toBe(true);
    expect(connect(other, otherCity.buildings[otherCity.buildings.length - 1]).ok).toBe(true);
    const stockpileSpot = spotFor(other, 'stockpile', woodcutterSpot!)!;
    expect(build(other, otherCity, 'stockpile', stockpileSpot.x, stockpileSpot.z).ok).toBe(true);
    expect(connect(other, otherCity.buildings[otherCity.buildings.length - 1]).ok).toBe(true);

    const city2: City = { ...otherCity, id: city1.id + 1 };
    city2.harbour = { ...city2.harbour, id: world.nextId++ };
    world.cities.push(city2);

    let sawWoodcutterWalker = false;
    let sawPorterWalker = false;
    for (let t = 0; t < 400; t++) {
      advance(world, 1);
      sawWoodcutterWalker ||= city2.walkers.some((walker) => walker.kind === 'woodcutter');
      sawPorterWalker ||= city2.walkers.some((walker) => walker.kind === 'porter');
    }

    expect(sawWoodcutterWalker).toBe(true);
    expect(world.felled.length).toBeGreaterThan(0);
    expect(sawPorterWalker).toBe(true);
    expect(city1.produced).toBeGreaterThan(0);
  });

  test('walkers, buildings, harbours and wildlife across every city draw from the single shared World.nextId allocator', () => {
    const { world, city1, city2 } = foundedTwoCityWorld();
    expect(buildStarterNeighbourhood(world, city1).ok).toBe(true);
    expect(buildStarterNeighbourhood(world, city2).ok).toBe(true);
    advance(world, 90);

    const allIds = [
      ...city1.buildings, ...city2.buildings,
      ...city1.walkers, ...city2.walkers,
      ...world.wildlife,
    ].map((entity) => entity.id);
    allIds.push(city1.harbour.id, city2.harbour.id);

    expect(new Set(allIds).size).toBe(allIds.length);
    for (const id of allIds) expect(id).toBeLessThan(world.nextId);
  });
});

describe('persistence still refuses more than one city', () => {
  test('a save with two cities is rejected rather than silently accepted', () => {
    const { world } = foundedTwoCityWorld();
    const raw = JSON.parse(serializeWorld(world));
    expect(raw.cities.length).toBe(2);
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });
});
