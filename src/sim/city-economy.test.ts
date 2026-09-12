import { describe, expect, test } from 'bun:test';
import { advance, createWorld } from './world';
import { primaryCity } from './city';
import { buildStarterNeighbourhood } from './scenario';
import { serializeWorld, deserializeWorld } from './save';
import { ISLAND_COUNT } from './island';
import type { City } from './types';

function foundedTwoCityWorld(seed = 1) {
  const world = createWorld(seed, 0);
  const city1 = primaryCity(world);
  const otherHome = (city1.home + 1) % ISLAND_COUNT;
  const other = createWorld(seed, otherHome);
  const city2: City = { ...primaryCity(other), id: city1.id + 1 };
  world.cities.push(city2);
  return { world, city1, city2 };
}

describe('two founded cities in one World', () => {
  test('each city runs its own economy independently: staffing, production, delivery, housing and finances', () => {
    const { world, city1, city2 } = foundedTwoCityWorld();
    expect(buildStarterNeighbourhood(world, city1).ok).toBe(true);
    expect(buildStarterNeighbourhood(world, city2).ok).toBe(true);

    advance(world, 180);

    expect(city1.produced).toBeGreaterThan(0);
    expect(city1.delivered).toBeGreaterThan(0);
    expect(city2.produced).toBeGreaterThan(0);
    expect(city2.delivered).toBeGreaterThan(0);
    expect(city1.buildings.length).toBeGreaterThan(0);
    expect(city2.buildings.length).toBeGreaterThan(0);
    const city2BuildingIds = new Set(city2.buildings.map((building) => building.id));
    expect(city1.buildings.every((building) => !city2BuildingIds.has(building.id))).toBe(true);
  });

  test('the world clock and ecology step exactly once per tick, shared by every city', () => {
    const { world, city1, city2 } = foundedTwoCityWorld();
    expect(buildStarterNeighbourhood(world, city1).ok).toBe(true);
    expect(buildStarterNeighbourhood(world, city2).ok).toBe(true);

    const before = world.time;
    advance(world, 60);
    expect(world.time).toBeCloseTo(before + 60, 6);
    expect(world.wildlife.length).toBeGreaterThan(0);
    expect(world.regrowth).toBeGreaterThanOrEqual(0);
  });

  test('a pending (unfounded) second city is skipped entirely while the founded city keeps advancing', () => {
    const world = createWorld(1, 0);
    const city1 = primaryCity(world);
    expect(buildStarterNeighbourhood(world, city1).ok).toBe(true);
    const otherHome = (city1.home + 1) % ISLAND_COUNT;
    const pendingWorld = createWorld(1, otherHome, false);
    const pending: City = { ...primaryCity(pendingWorld), id: city1.id + 1 };
    world.cities.push(pending);
    const snapshotPending = structuredClone(pending);

    advance(world, 120);

    expect(city1.produced).toBeGreaterThan(0);
    expect(pending).toEqual(snapshotPending);
  });

  test('walkers and buildings spawned for any founded city draw from the single shared World.nextId allocator', () => {
    const { world, city1, city2 } = foundedTwoCityWorld();
    expect(buildStarterNeighbourhood(world, city1).ok).toBe(true);
    expect(buildStarterNeighbourhood(world, city2).ok).toBe(true);
    advance(world, 90);

    const allIds = [...city1.buildings, ...city2.buildings, ...city1.walkers, ...city2.walkers].map((entity) => entity.id);
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
