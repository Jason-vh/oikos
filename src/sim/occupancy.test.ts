import { describe, expect, test } from 'bun:test';
import { build, createWorld, placement, placeRoadPath, demolish } from './world';
import { primaryCity } from './city';
import { foundHarbour, foundingPlacement, FOUNDING_RANGE } from './founding';
import { demolitionPreview, footprintTileIssues, suitableFarmGround } from './construction';
import { foundSecondCity, freshRoadSpot } from './testing';
import { buildStarterNeighbourhood } from './scenario';
import { footprintTiles, mapOf } from './grid';
import { foreignOccupancy } from './occupancy';
import { ISLAND_COUNT, terrainOn, tileAtOn, tileIndexOn, type IslandMap } from './island';
import type { Building, City, World } from './types';

function sharedIslandWorld(seed = 1): { world: World; city1: City; city2: City } {
  const world = createWorld(seed, 0);
  const city1 = primaryCity(world);
  const city2 = foundSecondCity(world, city1.home, false);
  return { world, city1, city2 };
}

function differentIslandWorld(seed = 1): { world: World; city1: City; city2: City } {
  const world = createWorld(seed, 0);
  const city1 = primaryCity(world);
  const otherHome = (city1.home + 1) % ISLAND_COUNT;
  const city2 = foundSecondCity(world, otherHome);
  return { world, city1, city2 };
}

function clearFoundingSite(world: World, city: City): { x: number; z: number } {
  const map = mapOf(world, city);
  const { entry } = map;
  for (let z = entry.z - FOUNDING_RANGE; z < entry.z; z++) {
    for (let x = entry.x - FOUNDING_RANGE; x <= entry.x + FOUNDING_RANGE; x++) {
      if (foundingPlacement(world, city, x, z).ok) return { x, z };
    }
  }
  throw new Error('No clear founding site.');
}

function clearHouseSpot(world: World, city: City): { x: number; z: number } {
  const map = mapOf(world, city);
  const home = map.islands[city.home];
  for (let z = home.z; z < home.z + home.depth; z++) {
    for (let x = home.x; x < home.x + home.width; x++) {
      if (placement(world, city, 'house', x, z).ok) return { x, z };
    }
  }
  throw new Error('No clear house spot.');
}

function introduceForeignObstacle(world: World, foreign: City, map: IslandMap, tile: number, kind: 'road' | 'building' | 'harbour'): void {
  if (kind === 'road') {
    foreign.roads.push(tile);
    return;
  }
  const { x, z } = tileAtOn(map, tile);
  if (kind === 'harbour') {
    foreign.harbour.x = x;
    foreign.harbour.z = z;
    return;
  }
  foreign.buildings.push({
    id: world.nextId++, x, z, kind: 'house', rotation: 0, tier: 1, residents: 0, food: 0, water: 0,
    condition: 100, stores: {}, progress: 0, workers: 0, vendorEnabled: false, vendorInstalled: false,
    connected: false, serviceTimer: 0, upgradeTimer: 0,
  });
}

describe('foreignOccupancy', () => {
  test('is empty with a single city', () => {
    const world = createWorld(1);
    const occupancy = foreignOccupancy(world, primaryCity(world));
    expect(occupancy.roads.size).toBe(0);
    expect(occupancy.buildings.size).toBe(0);
  });

  test('includes a second founded city\'s roads, buildings and harbour, from either side', () => {
    const { world, city1, city2 } = sharedIslandWorld();
    const site = clearFoundingSite(world, city2);
    expect(foundHarbour(world, city2, site.x, site.z).ok).toBe(true);

    const fromCity1 = foreignOccupancy(world, city1);
    expect(city2.roads.every((tile) => fromCity1.roads.has(tile))).toBe(true);
    expect(fromCity1.buildings.has(tileIndexOn(mapOf(world, city2), city2.harbour.x, city2.harbour.z))).toBe(true);

    const fromCity2 = foreignOccupancy(world, city2);
    expect(city1.roads.every((tile) => fromCity2.roads.has(tile))).toBe(true);
    expect(fromCity2.buildings.has(tileIndexOn(mapOf(world, city1), city1.harbour.x, city1.harbour.z))).toBe(true);
  });

  test('excludes a pending city\'s placeholder harbour but includes its already-claimed roads', () => {
    const { world, city1, city2 } = sharedIslandWorld();
    expect(city2.founded).toBe(false);

    const fromCity1 = foreignOccupancy(world, city1);
    const placeholderTile = tileIndexOn(mapOf(world, city2), city2.harbour.x, city2.harbour.z);
    expect(fromCity1.buildings.has(placeholderTile)).toBe(false);
    expect(city2.roads.every((tile) => fromCity1.roads.has(tile))).toBe(true);
  });
});

describe('a foreign road, building or founded harbour blocks placement on a clear tile', () => {
  for (const kind of ['road', 'building', 'harbour'] as const) {
    test(`${kind}: a tile that placement accepted turns rejected once city1 puts a foreign ${kind} on it, without mutating the World`, () => {
      const { world, city1, city2 } = sharedIslandWorld();
      const site = clearFoundingSite(world, city2);
      expect(foundHarbour(world, city2, site.x, site.z).ok).toBe(true);

      const spot = clearHouseSpot(world, city2);
      expect(placement(world, city2, 'house', spot.x, spot.z).ok).toBe(true);

      const map = mapOf(world, city2);
      const tile = tileIndexOn(map, spot.x, spot.z);
      introduceForeignObstacle(world, city1, map, tile, kind);

      expect(placement(world, city2, 'house', spot.x, spot.z).ok).toBe(false);
      const before = structuredClone(world);
      expect(build(world, city2, 'house', spot.x, spot.z).ok).toBe(false);
      expect(world).toEqual(before);
    });
  }
});

describe('a foreign building or founded harbour still blocks a tile that is already the city\'s own road', () => {
  for (const kind of ['building', 'harbour'] as const) {
    test(`${kind}: re-laying an own road tile is rejected once a foreign ${kind} covers it`, () => {
      const { world, city1, city2 } = sharedIslandWorld();
      const site = clearFoundingSite(world, city2);
      expect(foundHarbour(world, city2, site.x, site.z).ok).toBe(true);

      const ownRoadTile = city2.roads[0];
      const map = mapOf(world, city2);
      const { x, z } = tileAtOn(map, ownRoadTile);
      expect(placement(world, city2, 'road', x, z).ok).toBe(true);

      introduceForeignObstacle(world, city1, map, ownRoadTile, kind);

      expect(placement(world, city2, 'road', x, z).ok).toBe(false);
      const before = structuredClone(world);
      expect(build(world, city2, 'road', x, z).ok).toBe(false);
      expect(world).toEqual(before);

      const pathResult = placeRoadPath(world, city2, [{ x, z }]);
      expect(pathResult.ok).toBe(false);
      expect(world).toEqual(before);
    });
  }
});

describe('a duplicate foreign road record leaves a city\'s own road free to re-lay', () => {
  test('re-laying an own road tile that another city also happens to record is still free', () => {
    const { world, city1, city2 } = sharedIslandWorld();
    const site = clearFoundingSite(world, city2);
    expect(foundHarbour(world, city2, site.x, site.z).ok).toBe(true);

    const ownTile = city2.roads[0];
    expect(city1.roads.includes(ownTile)).toBe(true);
    const { x, z } = tileAtOn(mapOf(world, city2), ownTile);
    const before = structuredClone(world);
    expect(build(world, city2, 'road', x, z)).toEqual({ ok: true, reason: 'Road laid.' });
    expect(world).toEqual(before);
  });

  test('a genuinely foreign-only road, not shared with the acting city, still blocks a new road there', () => {
    const { world, city1, city2 } = sharedIslandWorld();
    const site = clearFoundingSite(world, city2);
    expect(foundHarbour(world, city2, site.x, site.z).ok).toBe(true);

    const extension = freshRoadSpot(world)!;
    expect(extension).not.toBeNull();
    expect(build(world, city1, 'road', extension.x, extension.z).ok).toBe(true);
    const foreignTile = tileIndexOn(mapOf(world, city2), extension.x, extension.z);
    expect(city2.roads.includes(foreignTile)).toBe(false);

    expect(placement(world, city2, 'road', extension.x, extension.z).ok).toBe(false);
    const before = structuredClone(world);
    expect(build(world, city2, 'road', extension.x, extension.z).ok).toBe(false);
    expect(world).toEqual(before);
  });
});

describe('founding respects foreign occupancy', () => {
  for (const kind of ['road', 'building', 'harbour'] as const) {
    test(`${kind}: a clear founding site turns rejected once city1 puts a foreign ${kind} on it, atomically`, () => {
      const { world, city1, city2 } = sharedIslandWorld();
      const site = clearFoundingSite(world, city2);
      expect(foundingPlacement(world, city2, site.x, site.z).ok).toBe(true);

      const map = mapOf(world, city2);
      const tile = tileIndexOn(map, site.x, site.z);
      introduceForeignObstacle(world, city1, map, tile, kind);

      expect(foundingPlacement(world, city2, site.x, site.z).ok).toBe(false);
      const before = structuredClone(world);
      expect(foundHarbour(world, city2, site.x, site.z).ok).toBe(false);
      expect(world).toEqual(before);
      expect(city2.founded).toBe(false);
    });
  }

  test('foundingPlacement still succeeds at a genuinely clear site on a shared island', () => {
    const { world, city2 } = sharedIslandWorld();
    const site = clearFoundingSite(world, city2);
    expect(foundHarbour(world, city2, site.x, site.z).ok).toBe(true);
    expect(city2.founded).toBe(true);
  });
});

describe('construction previews reflect foreign occupancy', () => {
  test('suitableFarmGround excludes fertile tiles claimed by another city', () => {
    const { world, city1, city2 } = sharedIslandWorld();
    const site = clearFoundingSite(world, city2);
    expect(foundHarbour(world, city2, site.x, site.z).ok).toBe(true);

    const map = mapOf(world, city1);
    let fertile: { x: number; z: number } | null = null;
    const home = map.islands[city1.home];
    for (let z = home.z; z < home.z + home.depth && !fertile; z++) {
      for (let x = home.x; x < home.x + home.width; x++) {
        if (terrainOn(map, x, z) === 'fertile' && placement(world, city1, 'farm', x, z).ok) { fertile = { x, z }; break; }
      }
    }
    expect(fertile).not.toBeNull();
    const farmTile = tileIndexOn(mapOf(world, city2), fertile!.x, fertile!.z);
    expect(suitableFarmGround(world, city2).some((tile) => tileIndexOn(mapOf(world, city2), tile.x, tile.z) === farmTile)).toBe(true);

    expect(build(world, city1, 'farm', fertile!.x, fertile!.z).ok).toBe(true);
    expect(suitableFarmGround(world, city2).some((tile) => tileIndexOn(mapOf(world, city2), tile.x, tile.z) === farmTile)).toBe(false);
  });

  test('footprintTileIssues shows a clear house footprint, then blocks exactly the tile a foreign road lands on', () => {
    const { world, city1, city2 } = sharedIslandWorld();
    const site = clearFoundingSite(world, city2);
    expect(foundHarbour(world, city2, site.x, site.z).ok).toBe(true);

    const spot = clearHouseSpot(world, city2);
    const baseline = footprintTileIssues(world, city2, 'house', spot.x, spot.z, 0);
    expect(baseline.every((tile) => !tile.blocked)).toBe(true);

    const map = mapOf(world, city2);
    const touchedTile = tileIndexOn(map, spot.x, spot.z);
    introduceForeignObstacle(world, city1, map, touchedTile, 'road');

    const after = footprintTileIssues(world, city2, 'house', spot.x, spot.z, 0);
    expect(after.find((tile) => tile.x === spot.x && tile.z === spot.z)?.blocked).toBe(true);
    const untouched = after.filter((tile) => !(tile.x === spot.x && tile.z === spot.z));
    expect(untouched.every((tile) => !tile.blocked)).toBe(true);
  });
});

describe('two cities sharing one island', () => {
  test('a second city\'s building placements route around the first\'s starter neighbourhood, with every entity id staying globally unique', () => {
    const { world, city1, city2 } = sharedIslandWorld();
    const site = clearFoundingSite(world, city2);
    expect(foundHarbour(world, city2, site.x, site.z).ok).toBe(true);
    expect(buildStarterNeighbourhood(world, city1).ok).toBe(true);

    const map = mapOf(world, city1);
    const home = map.islands[city2.home];
    let placed = 0;
    for (let z = home.z; z < home.z + home.depth && placed < 2; z++) {
      for (let x = home.x; x < home.x + home.width && placed < 2; x++) {
        if (!placement(world, city2, 'house', x, z).ok) continue;
        expect(build(world, city2, 'house', x, z).ok).toBe(true);
        placed++;
      }
    }
    expect(placed).toBe(2);
    const city1Tiles = new Set(city1.buildings.flatMap((building) => footprintTiles(map, building)));
    const city2Tiles = new Set(city2.buildings.flatMap((building) => footprintTiles(map, building)));
    expect([...city1Tiles].some((tile) => city2Tiles.has(tile))).toBe(false);
    expect(city1.roads.some((tile) => city2Tiles.has(tile))).toBe(false);
    expect(city2.roads.some((tile) => city1Tiles.has(tile))).toBe(false);

    const ids = [
      ...city1.buildings, ...city2.buildings,
      ...city1.walkers, ...city2.walkers,
      ...world.wildlife,
    ].map((entity) => entity.id);
    ids.push(city1.harbour.id, city2.harbour.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toBeLessThan(world.nextId);
  });
});

describe('demolition and legacy off-home infrastructure remain city-local', () => {
  test('a legacy building city1 left on city2\'s home island is still found and demolished locally, leaving city2 untouched', () => {
    const { world, city1, city2 } = differentIslandWorld();

    const spot = clearHouseSpot(world, city2);
    const legacy: Building = {
      id: world.nextId++, x: spot.x, z: spot.z, kind: 'house', rotation: 0, tier: 1, residents: 0, food: 0, water: 0,
      condition: 100, stores: {}, progress: 0, workers: 0, vendorEnabled: false, vendorInstalled: false,
      connected: false, serviceTimer: 0, upgradeTimer: 0,
    };
    city1.buildings.push(legacy);
    const city2Before = structuredClone(city2);

    const preview = demolitionPreview(world, city1, spot.x, spot.z);
    expect(preview?.buildingId).toBe(legacy.id);
    expect(demolish(world, city1, spot.x, spot.z).ok).toBe(true);
    expect(city1.buildings.some((building) => building.id === legacy.id)).toBe(false);
    expect(city2).toEqual(city2Before);

    expect(placement(world, city2, 'house', spot.x, spot.z).ok).toBe(true);
  });
});
