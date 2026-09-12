import { describe, expect, test } from 'bun:test';
import { build, createWorld, placement, placeRoadPath, demolish } from './world';
import { primaryCity } from './city';
import { foundHarbour, foundingPlacement, FOUNDING_RANGE } from './founding';
import { demolitionPreview, footprintTileIssues, suitableFarmGround } from './construction';
import { foundSecondCity, freshRoadSpot } from './testing';
import { buildStarterNeighbourhood } from './scenario';
import { footprintTiles } from './grid';
import { foreignOccupancy } from './occupancy';
import { mapOf } from './grid';
import { terrainOn, tileAtOn, tileIndexOn } from './island';
import type { Building, City, World } from './types';

function sharedIslandWorld(seed = 1): { world: World; city1: City; city2: City } {
  const world = createWorld(seed, 0);
  const city1 = primaryCity(world);
  const city2 = foundSecondCity(world, city1.home, false);
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

describe('construction blocks on foreign occupancy', () => {
  test('a foreign road blocks a building placement, without mutating the World', () => {
    const { world, city1, city2 } = sharedIslandWorld();
    const site = clearFoundingSite(world, city2);
    expect(foundHarbour(world, city2, site.x, site.z).ok).toBe(true);
    const before = structuredClone(world);

    const foreignRoadTile = city1.roads[0];
    const { x, z } = tileAtOn(mapOf(world, city2), foreignRoadTile);
    expect(placement(world, city2, 'house', x, z).ok).toBe(false);
    expect(build(world, city2, 'house', x, z).ok).toBe(false);

    expect(world).toEqual(before);
  });

  test('a foreign building blocks a building placement, without mutating the World', () => {
    const { world, city1, city2 } = sharedIslandWorld();
    const site = clearFoundingSite(world, city2);
    expect(foundHarbour(world, city2, site.x, site.z).ok).toBe(true);

    const map = mapOf(world, city1);
    let spot: { x: number; z: number } | null = null;
    const home = map.islands[city1.home];
    for (let z = home.z; z < home.z + home.depth && !spot; z++) {
      for (let x = home.x; x < home.x + home.width; x++) {
        if (placement(world, city1, 'house', x, z).ok) { spot = { x, z }; break; }
      }
    }
    expect(spot).not.toBeNull();
    expect(build(world, city1, 'house', spot!.x, spot!.z).ok).toBe(true);
    const before = structuredClone(world);

    expect(placement(world, city2, 'fountain', spot!.x, spot!.z).ok).toBe(false);
    expect(build(world, city2, 'fountain', spot!.x, spot!.z).ok).toBe(false);
    expect(world).toEqual(before);
  });

  test('a foreign founded harbour blocks a building placement, without mutating the World', () => {
    const { world, city1, city2 } = sharedIslandWorld();
    const site = clearFoundingSite(world, city2);
    expect(foundHarbour(world, city2, site.x, site.z).ok).toBe(true);
    const before = structuredClone(world);

    const map = mapOf(world, city1);
    const { x, z } = tileAtOn(map, tileIndexOn(map, city1.harbour.x, city1.harbour.z));
    expect(placement(world, city2, 'house', x, z).ok).toBe(false);
    expect(build(world, city2, 'house', x, z).ok).toBe(false);
    expect(world).toEqual(before);
  });

  test('a foreign road blocks laying a new road on that tile, but a city\'s own road stays free to re-lay', () => {
    const { world, city1, city2 } = sharedIslandWorld();
    const site = clearFoundingSite(world, city2);
    expect(foundHarbour(world, city2, site.x, site.z).ok).toBe(true);
    const extension = freshRoadSpot(world)!;
    expect(extension).not.toBeNull();
    expect(build(world, city1, 'road', extension.x, extension.z).ok).toBe(true);

    const ownTile = city2.roads[0];
    const { x: ownX, z: ownZ } = tileAtOn(mapOf(world, city2), ownTile);
    const before = structuredClone(world);
    expect(build(world, city2, 'road', ownX, ownZ)).toEqual({ ok: true, reason: 'Road laid.' });
    expect(world).toEqual(before);

    const foreignTile = tileIndexOn(mapOf(world, city2), extension.x, extension.z);
    expect(city2.roads.includes(foreignTile)).toBe(false);
    expect(placement(world, city2, 'road', extension.x, extension.z).ok).toBe(false);
    expect(build(world, city2, 'road', extension.x, extension.z).ok).toBe(false);
    expect(world).toEqual(before);
  });

  test('placeRoadPath rejects a batch that steps onto foreign ground atomically, charging nothing', () => {
    const { world, city1, city2 } = sharedIslandWorld();
    const site = clearFoundingSite(world, city2);
    expect(foundHarbour(world, city2, site.x, site.z).ok).toBe(true);
    const extension = freshRoadSpot(world)!;
    expect(extension).not.toBeNull();
    expect(build(world, city1, 'road', extension.x, extension.z).ok).toBe(true);
    const before = structuredClone(world);

    const map = mapOf(world, city2);
    const own = tileAtOn(map, city2.roads[0]);

    const result = placeRoadPath(world, city2, [own, extension]);
    expect(result.ok).toBe(false);
    expect(world).toEqual(before);
  });
});

describe('founding respects foreign occupancy', () => {
  test('foundingPlacement and foundHarbour reject a site over another city\'s road, building or harbour', () => {
    const { world, city1, city2 } = sharedIslandWorld();

    const map = mapOf(world, city1);
    const { x: roadX, z: roadZ } = tileAtOn(map, city1.roads[0]);
    expect(foundingPlacement(world, city2, roadX, roadZ).ok).toBe(false);
    const before = structuredClone(world);
    expect(foundHarbour(world, city2, roadX, roadZ).ok).toBe(false);
    expect(world).toEqual(before);
    expect(city2.founded).toBe(false);
  });

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
    expect(build(world, city1, 'farm', fertile!.x, fertile!.z).ok).toBe(true);

    const farmTile = tileIndexOn(mapOf(world, city2), fertile!.x, fertile!.z);
    const ground = suitableFarmGround(world, city2);
    expect(ground.some((tile) => tileIndexOn(mapOf(world, city2), tile.x, tile.z) === farmTile)).toBe(false);
  });

  test('footprintTileIssues marks a foreign building\'s footprint as blocked', () => {
    const { world, city1, city2 } = sharedIslandWorld();
    const site = clearFoundingSite(world, city2);
    expect(foundHarbour(world, city2, site.x, site.z).ok).toBe(true);

    const issues = footprintTileIssues(world, city2, 'house', city1.harbour.x, city1.harbour.z, 0);
    expect(issues.some((tile) => tile.blocked)).toBe(true);
  });
});

describe('two full economies on one shared island', () => {
  test('a second city\'s buildings route around the first\'s starter neighbourhood and every entity id stays globally unique', () => {
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
  test('a city\'s legacy building sitting on another city\'s home island is still found and demolished locally', () => {
    const { world, city1, city2 } = sharedIslandWorld();
    const site = clearFoundingSite(world, city2);
    expect(foundHarbour(world, city2, site.x, site.z).ok).toBe(true);

    const map = mapOf(world, city2);
    let spot: { x: number; z: number } | null = null;
    const home = map.islands[city2.home];
    for (let z = home.z; z < home.z + home.depth && !spot; z++) {
      for (let x = home.x; x < home.x + home.width; x++) {
        if (placement(world, city2, 'house', x, z).ok) { spot = { x, z }; break; }
      }
    }
    expect(spot).not.toBeNull();
    const legacy: Building = {
      id: world.nextId++, x: spot!.x, z: spot!.z, kind: 'house', rotation: 0, tier: 1, residents: 0, food: 0, water: 0,
      condition: 100, stores: {}, progress: 0, workers: 0, vendorEnabled: false, vendorInstalled: false,
      connected: false, serviceTimer: 0, upgradeTimer: 0,
    };
    city1.buildings.push(legacy);

    const preview = demolitionPreview(world, city1, spot!.x, spot!.z);
    expect(preview?.buildingId).toBe(legacy.id);
    expect(demolish(world, city1, spot!.x, spot!.z).ok).toBe(true);
    expect(city1.buildings.some((building) => building.id === legacy.id)).toBe(false);

    expect(placement(world, city2, 'house', spot!.x, spot!.z).ok).toBe(true);
  });
});
