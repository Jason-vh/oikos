import { expect, test } from 'bun:test';
import { foundHarbour, foundingPlacement, FOUNDING_RANGE } from './founding';
import { mapOf } from './grid';
import { canUndoConstruction } from './history';
import { ISLAND_COUNT } from './island';
import { deserializeWorld, serializeWorld } from './save';
import { buildStarterNeighbourhood } from './scenario';
import type { World } from './types';
import { advance, build, createWorld, demolish, getSummary, placement, placeRoadPath, setVendor } from './world';
import { primaryCity } from './city';

function alternateSite(world: World) {
  const { entry } = mapOf(world);
  const harbour = primaryCity(world).harbour;
  for (let z = entry.z - FOUNDING_RANGE; z < entry.z; z++) {
    for (let x = entry.x - FOUNDING_RANGE; x <= entry.x + FOUNDING_RANGE; x++) {
      if (x === harbour.x && z === harbour.z) continue;
      if (foundingPlacement(world, x, z).ok) return { x, z };
    }
  }
  throw new Error('No alternative founding site.');
}

for (const seed of [1, 2]) {
  for (let home = 0; home < ISLAND_COUNT; home++) {
    test(`seed ${seed}, island ${home + 1} can be founded at its prepared site`, () => {
      const world = createWorld(seed, home, false);
      const city = primaryCity(world);
      expect(city.harbour.connected).toBe(false);
      expect(foundHarbour(world, city.harbour.x, city.harbour.z).ok).toBe(true);
      expect(city.founded).toBe(true);
      expect(city.harbour.connected).toBe(true);
      expect(buildStarterNeighbourhood(world).ok).toBe(true);
      advance(world, 180);
      expect(getSummary(world).goal).toBe(true);
    });
  }
}

test('founding can choose a different dockyard site, which survives saves and cannot move again', () => {
  const world = createWorld(2, 0, false);
  const site = alternateSite(world);
  const money = primaryCity(world).money;
  expect(foundHarbour(world, site.x, site.z).ok).toBe(true);
  const city = primaryCity(world);
  expect(city.harbour.x).toBe(site.x);
  expect(city.harbour.z).toBe(site.z);
  expect(city.money).toBe(money);
  expect(city.harbour.connected).toBe(true);
  expect(deserializeWorld(serializeWorld(world))).toEqual(world);
  const before = serializeWorld(world);
  expect(foundHarbour(world, site.x + 1, site.z).ok).toBe(false);
  expect(serializeWorld(world)).toBe(before);
});

test('invalid sites do not consume the founding opportunity or mutate the city', () => {
  const world = createWorld(1, 0, false);
  const { entry, islands } = mapOf(world);
  const before = serializeWorld(world);
  const sites = [
    { x: -1, z: -1 },
    { x: .5, z: entry.z },
    { x: entry.x, z: entry.z - 4 },
    { x: entry.x, z: entry.z + 4 },
    islands[7].entry,
  ];
  for (const { x, z } of sites) {
    expect(foundingPlacement(world, x, z).ok).toBe(false);
    expect(foundHarbour(world, x, z).ok).toBe(false);
    expect(serializeWorld(world)).toBe(before);
  }
});

test('an unfinished founding round-trips and rejects normal commands without advancing time', () => {
  const world = createWorld(2, 7, false);
  const before = serializeWorld(world);
  const { entry } = mapOf(world);
  expect(placement(world, 'house', entry.x + 2, entry.z - 6).ok).toBe(false);
  expect(build(world, 'house', entry.x + 2, entry.z - 6).ok).toBe(false);
  expect(placeRoadPath(world, [entry]).ok).toBe(false);
  expect(demolish(world, entry.x, entry.z).ok).toBe(false);
  expect(setVendor(world, 0, true).ok).toBe(false);
  advance(world, 600);
  expect(serializeWorld(world)).toBe(before);
  expect(deserializeWorld(before)).toEqual(world);
  expect(canUndoConstruction(createWorld(2, 7), world)).toBe(false);
});

test('unfinished saves must retain the prepared roads and starting treasury', () => {
  const world = createWorld(2, 7, false);
  const startingMoney = primaryCity(world).money;
  for (const money of [-1, 0, startingMoney + 1]) {
    const cities = [{ ...primaryCity(world), money }];
    expect(deserializeWorld(serializeWorld({ ...world, cities }))).toBeNull();
  }
  for (const roads of [[], world.roads.slice(1), [...world.roads, 0], [0, ...world.roads.slice(1)]]) {
    expect(deserializeWorld(serializeWorld({ ...world, roads }))).toBeNull();
  }
  const loaded = deserializeWorld(serializeWorld({ ...world, roads: [...world.roads].reverse() }));
  expect(loaded).not.toBeNull();
  const harbour = primaryCity(loaded!).harbour;
  expect(foundHarbour(loaded!, harbour.x, harbour.z).ok).toBe(true);
});

test('saves cannot hide a populated or progressed city behind an unfinished founding', () => {
  const world = createWorld(2, 0);
  expect(buildStarterNeighbourhood(world).ok).toBe(true);
  primaryCity(world).founded = false;
  expect(deserializeWorld(serializeWorld(world))).toBeNull();
  const pending = createWorld(2, 0, false);
  pending.time = 1;
  expect(deserializeWorld(serializeWorld(pending))).toBeNull();
});
