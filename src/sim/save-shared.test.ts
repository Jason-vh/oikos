import { describe, expect, test } from 'bun:test';
import { deserializeSharedWorld, deserializeWorld, serializeWorld } from './save';
import { advance, createSharedWorld, createWorld } from './world';
import { claimHarbour } from './claims';
import { findHarbourSite } from './founding';
import { buildStarterNeighbourhood } from './scenario';
import { ISLAND_COUNT, islandFor } from './island';
import { HARBOUR_ID } from './harbour';
import type { City, World } from './types';

function foundAt(world: World, home: number, name = `City ${home}`): City {
  const site = findHarbourSite(islandFor(world.seed), home)!;
  const result = claimHarbour(world, name, site.x, site.z, site.rotation);
  expect(result.ok).toBe(true);
  return result.city!;
}

describe('deserializeSharedWorld round trips', () => {
  test('an empty canonical archipelago round-trips', () => {
    const world = createSharedWorld();
    const restored = deserializeSharedWorld(serializeWorld(world));
    expect(restored).toEqual(world);
  });

  test('two claimed, founded and developed cities round-trip', () => {
    const world = createSharedWorld();
    const city1 = foundAt(world, 0);
    const city2 = foundAt(world, 1);
    expect(buildStarterNeighbourhood(world, city1).ok).toBe(true);
    expect(buildStarterNeighbourhood(world, city2).ok).toBe(true);
    advance(world, 90);

    const restored = deserializeSharedWorld(serializeWorld(world));
    expect(restored).toEqual(world);
  });

  test('claiming every island round-trips', () => {
    const world = createSharedWorld();
    for (let home = 0; home < ISLAND_COUNT; home++) foundAt(world, home);
    expect(world.cities.length).toBe(ISLAND_COUNT);

    const restored = deserializeSharedWorld(serializeWorld(world));
    expect(restored).toEqual(world);
  });

  test('an aged pending city round-trips alongside an established economy, and both continue identically after reload', () => {
    const world = createSharedWorld();
    const established = foundAt(world, 0);
    expect(buildStarterNeighbourhood(world, established).ok).toBe(true);
    advance(world, 90);
    const pending = foundAt(world, 1);

    const restored = deserializeSharedWorld(serializeWorld(world));
    expect(restored).toEqual(world);

    advance(world, 60);
    advance(restored!, 60);
    expect(restored!.time).toBe(world.time);
    expect(restored!.cities.find((city) => city.id === established.id)).toEqual(world.cities.find((city) => city.id === established.id));
    expect(restored!.cities.find((city) => city.id === pending.id)).toEqual(world.cities.find((city) => city.id === pending.id));
  });

  test('an empty archipelago has no clock to run', () => {
    const world = createSharedWorld();
    advance(world, 100);
    expect(world.time).toBe(0);

    const restored = deserializeSharedWorld(serializeWorld(world));
    expect(restored).toEqual(world);
  });

  test('an aged shared world round-trips, preserving its shared time, remainder and regrowth', () => {
    const world = createSharedWorld();
    foundAt(world, 0);
    foundAt(world, 1);
    const raw = JSON.parse(serializeWorld(world));
    raw.time = 500;
    raw.remainder = 0.1;
    raw.regrowth = 300;
    raw.felled = [];

    const restored = deserializeSharedWorld(JSON.stringify(raw));

    expect(restored).not.toBeNull();
    expect(restored!.time).toBe(500);
    expect(restored!.remainder).toBeCloseTo(0.1, 10);
    expect(restored!.regrowth).toBe(300);
    expect(restored!.felled).toEqual([]);
  });

  test('an aged, empty shared world round-trips, preserving its shared ecology with no cities at all', () => {
    const world = createSharedWorld();
    const raw = JSON.parse(serializeWorld(world));
    raw.time = 500;
    raw.remainder = 0.2;
    raw.regrowth = 150;
    raw.felled = [42];

    const restored = deserializeSharedWorld(JSON.stringify(raw));

    expect(restored).not.toBeNull();
    expect(restored!.cities).toEqual([]);
    expect(restored!.time).toBe(500);
    expect(restored!.remainder).toBeCloseTo(0.2, 10);
    expect(restored!.regrowth).toBe(150);
    expect(restored!.felled).toEqual([42]);
  });
});

describe('local policy: deserializeWorld accepts exactly one city', () => {
  test('rejects an empty shared world', () => {
    const world = createSharedWorld();
    expect(deserializeWorld(serializeWorld(world))).toBeNull();
  });

  test('rejects a shared world with two cities', () => {
    const world = createSharedWorld();
    foundAt(world, 0);
    foundAt(world, 1);
    expect(deserializeWorld(serializeWorld(world))).toBeNull();
  });

  test('still accepts a genuine single-city world', () => {
    const world = createWorld();
    expect(deserializeWorld(serializeWorld(world))).toEqual(world);
  });
});

describe('shared policy: deserializeSharedWorld accepts 0..ISLAND_COUNT cities', () => {
  test('rejects more cities than there are islands, even before per-city validation would fail', () => {
    const world = createSharedWorld();
    for (let home = 0; home < ISLAND_COUNT; home++) foundAt(world, home);
    const raw = JSON.parse(serializeWorld(world));
    raw.cities.push({ ...raw.cities[0], id: world.nextCityId });
    expect(deserializeSharedWorld(JSON.stringify(raw))).toBeNull();
  });
});

describe('global id validation across cities', () => {
  function twoCityRaw() {
    const world = createSharedWorld();
    const city1 = foundAt(world, 0);
    const city2 = foundAt(world, 1);
    expect(buildStarterNeighbourhood(world, city1).ok).toBe(true);
    expect(buildStarterNeighbourhood(world, city2).ok).toBe(true);
    return { world, raw: JSON.parse(serializeWorld(world)) as any };
  }

  test('rejects a building id reused across two different cities', () => {
    const { raw } = twoCityRaw();
    raw.cities[1].buildings[0].id = raw.cities[0].buildings[0].id;
    expect(deserializeSharedWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a wildlife id colliding with another city\'s building id', () => {
    const { raw } = twoCityRaw();
    raw.wildlife[0].id = raw.cities[0].buildings[0].id;
    expect(deserializeSharedWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a second harbour also claiming id 0', () => {
    const { raw } = twoCityRaw();
    raw.cities[0].harbour.id = HARBOUR_ID;
    raw.cities[1].harbour.id = HARBOUR_ID;
    expect(deserializeSharedWorld(JSON.stringify(raw))).toBeNull();
  });

  test('accepts exactly one harbour at id 0, a legacy artifact, alongside freshly claimed non-zero harbour ids', () => {
    const { raw } = twoCityRaw();
    expect(raw.cities[1].harbour.id).not.toBe(HARBOUR_ID);
    raw.cities[0].harbour.id = HARBOUR_ID;
    expect(deserializeSharedWorld(JSON.stringify(raw))).not.toBeNull();
  });

  test('rejects a harbour id at or beyond nextId', () => {
    const { raw } = twoCityRaw();
    raw.cities[1].harbour.id = raw.nextId;
    expect(deserializeSharedWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects duplicate city ids', () => {
    const { raw } = twoCityRaw();
    raw.cities[1].id = raw.cities[0].id;
    expect(deserializeSharedWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a city id at or beyond nextCityId', () => {
    const { raw } = twoCityRaw();
    raw.cities[1].id = raw.nextCityId;
    expect(deserializeSharedWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects duplicate city homes', () => {
    const { raw } = twoCityRaw();
    raw.cities[1].home = raw.cities[0].home;
    expect(deserializeSharedWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects an invalid or missing nextCityId', () => {
    const { raw } = twoCityRaw();
    raw.nextCityId = 'soon';
    expect(deserializeSharedWorld(JSON.stringify(raw))).toBeNull();
    delete raw.nextCityId;
    expect(deserializeSharedWorld(JSON.stringify(raw))).toBeNull();
  });
});

function twoDevelopedCities(): { world: World; city1: City; city2: City } {
  const world = createSharedWorld();
  const city1 = foundAt(world, 0);
  const city2 = foundAt(world, 1);
  expect(buildStarterNeighbourhood(world, city1).ok).toBe(true);
  expect(buildStarterNeighbourhood(world, city2).ok).toBe(true);
  return { world, city1, city2 };
}

describe('cross-city physical overlap is rejected on load', () => {
  test('rejects two cities whose roads share a tile', () => {
    const world = createSharedWorld();
    foundAt(world, 0);
    foundAt(world, 1);
    const raw = JSON.parse(serializeWorld(world));
    raw.cities[1].roads.push(raw.cities[0].roads[0]);
    expect(deserializeSharedWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a city\'s building footprint landing on another city\'s road', () => {
    const world = createSharedWorld();
    foundAt(world, 0);
    const city2 = foundAt(world, 1);
    expect(buildStarterNeighbourhood(world, city2).ok).toBe(true);
    const raw = JSON.parse(serializeWorld(world));
    const map = islandFor(world.seed, city2.home);
    const building = raw.cities[1].buildings[0];
    const roadTileIndex = raw.cities[0].roads[0];
    const roadTile = { x: roadTileIndex % map.width, z: Math.floor(roadTileIndex / map.width) };
    building.x = roadTile.x;
    building.z = roadTile.z;
    expect(deserializeSharedWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a walker whose homeId references another city\'s building', () => {
    const { world, city1, city2 } = twoDevelopedCities();
    let hasWalker = false;
    for (let t = 0; t < 400 && !hasWalker; t++) {
      advance(world, 1);
      hasWalker = city2.walkers.length > 0;
    }
    expect(hasWalker).toBe(true);

    const raw = JSON.parse(serializeWorld(world));
    expect(deserializeSharedWorld(JSON.stringify(raw))).not.toBeNull();

    const cityRaw2 = raw.cities.find((city: any) => city.id === city2.id);
    const cityRaw1 = raw.cities.find((city: any) => city.id === city1.id);
    cityRaw2.walkers[0].homeId = cityRaw1.buildings[0].id;
    expect(deserializeSharedWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a walker whose targetId references another city\'s building', () => {
    const { world, city1, city2 } = twoDevelopedCities();
    let targeting: number | null = null;
    for (let t = 0; t < 400 && targeting === null; t++) {
      advance(world, 1);
      const found = city2.walkers.find((walker) => walker.targetId !== null);
      if (found) targeting = found.id;
    }
    expect(targeting).not.toBeNull();

    const raw = JSON.parse(serializeWorld(world));
    expect(deserializeSharedWorld(JSON.stringify(raw))).not.toBeNull();

    const cityRaw2 = raw.cities.find((city: any) => city.id === city2.id);
    const cityRaw1 = raw.cities.find((city: any) => city.id === city1.id);
    const walkerRaw = cityRaw2.walkers.find((walker: any) => walker.id === targeting);
    walkerRaw.targetId = cityRaw1.buildings[0].id;
    expect(deserializeSharedWorld(JSON.stringify(raw))).toBeNull();
  });
});

describe('ids and allocators must be safe integers', () => {
  test('requires safe allocators and building ids below them', () => {
    const world = createSharedWorld();
    foundAt(world, 0);
    const raw = JSON.parse(serializeWorld(world));
    raw.cities[0].buildings.push({
      id: Number.MAX_SAFE_INTEGER - 1, x: 0, z: 0, kind: 'house', rotation: 0, tier: 1, residents: 0, food: 0, water: 0,
      condition: 100, stores: {}, progress: 0, workers: 0, vendorEnabled: false, vendorInstalled: false,
      connected: false, serviceTimer: 0, upgradeTimer: 0,
    });
    raw.nextId = Number.MAX_SAFE_INTEGER;
    expect(deserializeSharedWorld(JSON.stringify(raw))).not.toBeNull();

    raw.nextId = Number.MAX_SAFE_INTEGER + 1;
    expect(deserializeSharedWorld(JSON.stringify(raw))).toBeNull();

    raw.nextId = Number.MAX_SAFE_INTEGER;
    raw.cities[0].buildings[0].id = Number.MAX_SAFE_INTEGER;
    expect(deserializeSharedWorld(JSON.stringify(raw))).toBeNull();
  });

  test('accepts nextCityId at the safe ceiling and a city id below it; rejects an unsafe allocator', () => {
    const world = createSharedWorld();
    foundAt(world, 0);
    const raw = JSON.parse(serializeWorld(world));
    raw.cities[0].id = Number.MAX_SAFE_INTEGER - 1;
    raw.nextCityId = Number.MAX_SAFE_INTEGER;
    expect(deserializeSharedWorld(JSON.stringify(raw))).not.toBeNull();

    raw.nextCityId = Number.MAX_SAFE_INTEGER + 1;
    expect(deserializeSharedWorld(JSON.stringify(raw))).toBeNull();
  });

});
