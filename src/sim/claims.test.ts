import { describe, expect, test } from 'bun:test';
import { claimIsland } from './claims';
import { advance, createSharedWorld, createWorld, build } from './world';
import { foundHarbour } from './founding';
import { buildStarterNeighbourhood } from './scenario';
import { deserializeSharedWorld, serializeWorld } from './save';
import { ISLAND_COUNT, islandFor, tileAtOn } from './island';
import { STARTING_MONEY } from './catalog';
import { HARBOUR_ID } from './harbour';

describe('claimIsland', () => {
  test('a successful claim allocates a city id from nextCityId and a harbour id from the shared nextId', () => {
    const world = createSharedWorld();
    const beforeNextId = world.nextId;
    const beforeNextCityId = world.nextCityId;

    const result = claimIsland(world, 0);

    expect(result.ok).toBe(true);
    expect(result.city).not.toBeNull();
    expect(result.city!.id).toBe(beforeNextCityId);
    expect(world.nextCityId).toBe(beforeNextCityId + 1);
    expect(result.city!.harbour.id).toBe(beforeNextId);
    expect(result.city!.harbour.id).not.toBe(HARBOUR_ID);
    expect(world.nextId).toBe(beforeNextId + 1);
    expect(world.cities).toEqual([result.city!]);
    expect(result.city!.founded).toBe(false);
    expect(result.city!.money).toBe(STARTING_MONEY);
    expect(result.city!.buildings).toEqual([]);
    expect(result.city!.walkers).toEqual([]);
  });

  test('claiming several islands allocates distinct, increasing city and harbour ids', () => {
    const world = createSharedWorld();
    const first = claimIsland(world, 0);
    const second = claimIsland(world, 1);
    const third = claimIsland(world, 2);

    expect([first, second, third].every((result) => result.ok)).toBe(true);
    const cityIds = [first, second, third].map((result) => result.city!.id);
    const harbourIds = [first, second, third].map((result) => result.city!.harbour.id);
    expect(new Set(cityIds).size).toBe(3);
    expect(new Set(harbourIds).size).toBe(3);
    expect(cityIds[0]).toBeLessThan(cityIds[1]);
    expect(cityIds[1]).toBeLessThan(cityIds[2]);
  });

  test('a duplicate claim on an already-founded home is rejected without mutating the World', () => {
    const world = createSharedWorld();
    const first = claimIsland(world, 0).city!;
    expect(foundHarbour(world, first, first.harbour.x, first.harbour.z).ok).toBe(true);
    expect(first.founded).toBe(true);
    const before = structuredClone(world);

    const result = claimIsland(world, 0);

    expect(result.ok).toBe(false);
    expect(result.city).toBeNull();
    expect(world).toEqual(before);
  });

  test('a duplicate claim on a pending (unfounded) home is also rejected without mutating the World', () => {
    const world = createSharedWorld();
    const first = claimIsland(world, 0);
    expect(first.city!.founded).toBe(false);
    const before = structuredClone(world);

    const result = claimIsland(world, 0);

    expect(result.ok).toBe(false);
    expect(result.city).toBeNull();
    expect(world).toEqual(before);
  });

  test('an out-of-range home is rejected without mutating the World', () => {
    const world = createSharedWorld();
    const before = structuredClone(world);

    expect(claimIsland(world, -1).ok).toBe(false);
    expect(claimIsland(world, ISLAND_COUNT).ok).toBe(false);
    expect(claimIsland(world, 1.5).ok).toBe(false);
    expect(world).toEqual(before);
  });

  test('an island already holding another city\'s legacy off-home infrastructure is rejected without mutating the World', () => {
    const world = createSharedWorld();
    const city1 = claimIsland(world, 0).city!;
    expect(foundHarbour(world, city1, city1.harbour.x, city1.harbour.z).ok).toBe(true);

    const otherHome = 1;
    const otherMap = createWorld(world.seed, otherHome);
    const legacyRoad = otherMap.cities[0].roads[0];
    city1.roads.push(legacyRoad);
    expect(deserializeSharedWorld(serializeWorld(world))).not.toBeNull();
    const before = structuredClone(world);

    const result = claimIsland(world, otherHome);

    expect(result.ok).toBe(false);
    expect(result.city).toBeNull();
    expect(world).toEqual(before);
  });

  test('an island untouched by any city\'s infrastructure claims normally, unaffected by another city\'s unrelated legacy road elsewhere', () => {
    const world = createSharedWorld();
    const city1 = claimIsland(world, 0).city!;
    expect(foundHarbour(world, city1, city1.harbour.x, city1.harbour.z).ok).toBe(true);
    const otherMap = createWorld(world.seed, 1);
    city1.roads.push(otherMap.cities[0].roads[0]);
    expect(deserializeSharedWorld(serializeWorld(world))).not.toBeNull();
    const before = structuredClone(world);

    const result = claimIsland(world, 2);

    expect(result.ok).toBe(true);
    expect(result.city!.home).toBe(2);
    expect(world.cities.length).toBe(before.cities.length + 1);
  });

  test('an ordinary legacy building fully inside another city\'s target island, with no road there, is rejected without mutating the World', () => {
    const world = createSharedWorld();
    const city1 = claimIsland(world, 0).city!;
    expect(foundHarbour(world, city1, city1.harbour.x, city1.harbour.z).ok).toBe(true);

    const otherHome = 1;
    const map = islandFor(world.seed, otherHome);
    const island = map.islands[otherHome];
    const anchor = { x: island.x + Math.floor(island.width / 2), z: island.z + Math.floor(island.depth / 2) };
    city1.buildings.push({
      id: world.nextId++, x: anchor.x, z: anchor.z, kind: 'house', rotation: 0, tier: 1, residents: 0, food: 0, water: 0,
      condition: 100, stores: {}, progress: 0, workers: 0, vendorEnabled: false, vendorInstalled: false, connected: false, serviceTimer: 0, upgradeTimer: 0,
    });
    expect(deserializeSharedWorld(serializeWorld(world))).not.toBeNull();
    const before = structuredClone(world);

    const result = claimIsland(world, otherHome);

    expect(result.ok).toBe(false);
    expect(result.city).toBeNull();
    expect(world).toEqual(before);
  });

  test('a legacy building whose footprint only edges onto another city\'s target island is rejected (synthetic geometry, not asserted save-valid)', () => {
    const world = createSharedWorld();
    const city1 = claimIsland(world, 0).city!;
    expect(foundHarbour(world, city1, city1.harbour.x, city1.harbour.z).ok).toBe(true);

    const otherHome = 1;
    const map = islandFor(world.seed, otherHome);
    const island = map.islands[otherHome];
    const edgeAnchor = { x: island.x - 2, z: island.z };
    city1.buildings.push({
      id: world.nextId++, x: edgeAnchor.x, z: edgeAnchor.z, kind: 'house', rotation: 0, tier: 1, residents: 0, food: 0, water: 0,
      condition: 100, stores: {}, progress: 0, workers: 0, vendorEnabled: false, vendorInstalled: false, connected: false, serviceTimer: 0, upgradeTimer: 0,
    });
    const before = structuredClone(world);

    const result = claimIsland(world, otherHome);

    expect(result.ok).toBe(false);
    expect(result.city).toBeNull();
    expect(world).toEqual(before);
  });

  test('a new claim on an aged, established World leaves every existing city, the shared clock and the ecology untouched', () => {
    const world = createSharedWorld();
    const established = claimIsland(world, 0).city!;
    expect(foundHarbour(world, established, established.harbour.x, established.harbour.z).ok).toBe(true);
    expect(buildStarterNeighbourhood(world, established).ok).toBe(true);
    advance(world, 300);
    world.remainder = 0.1;
    world.felled = [established.roads[0]];
    world.regrowth = 123;
    const before = structuredClone(world);

    const result = claimIsland(world, 1);

    expect(result.ok).toBe(true);
    expect(world.time).toBe(before.time);
    expect(world.remainder).toBe(0.1);
    expect(world.wildlife).toEqual(before.wildlife);
    expect(world.felled).toEqual([established.roads[0]]);
    expect(world.regrowth).toBe(123);
    expect(world.cities[0]).toEqual(before.cities[0]);
    expect(world.cities.length).toBe(before.cities.length + 1);
    expect(world.nextCityId).toBe(before.nextCityId + 1);
    expect(world.nextId).toBe(before.nextId + 1);
  });

  test('a shared world stays frozen while every claimed city remains pending, whatever the number of claims', () => {
    const world = createSharedWorld();
    claimIsland(world, 0);
    claimIsland(world, 1);
    claimIsland(world, 2);
    expect(world.cities.every((city) => !city.founded)).toBe(true);

    advance(world, 500);

    expect(world.time).toBe(0);
    expect(world.remainder).toBe(0);
    expect(world.felled).toEqual([]);
    expect(world.regrowth).toBe(0);
  });

  test('a claimed city can be founded and built on normally afterward', () => {
    const world = createSharedWorld();
    const result = claimIsland(world, 0);
    const city = result.city!;
    expect(foundHarbour(world, city, city.harbour.x, city.harbour.z).ok).toBe(true);
    expect(city.founded).toBe(true);
    const map = islandFor(world.seed, city.home);
    const { x, z } = tileAtOn(map, city.roads[0]);
    expect(build(world, city, 'road', x, z)).toEqual({ ok: true, reason: 'Road laid.' });
  });

  test.each(['nextCityId', 'nextId'] as const)('exhausted %s rejects before either allocator changes', (allocator) => {
    const world = createSharedWorld();
    world[allocator] = Number.MAX_SAFE_INTEGER;
    const before = structuredClone(world);

    const result = claimIsland(world, 0);

    expect(result.ok).toBe(false);
    expect(result.city).toBeNull();
    expect(world).toEqual(before);
  });

  test('a nextCityId or nextId just below the safe-integer ceiling still allows a claim', () => {
    const world = createSharedWorld();
    world.nextCityId = Number.MAX_SAFE_INTEGER - 1;
    world.nextId = Number.MAX_SAFE_INTEGER - 1;

    const result = claimIsland(world, 0);

    expect(result.ok).toBe(true);
    expect(result.city!.id).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(world.nextCityId).toBe(Number.MAX_SAFE_INTEGER);
    expect(world.nextId).toBe(Number.MAX_SAFE_INTEGER);
  });
});
