import { describe, expect, test } from 'bun:test';
import { build, createWorld, placement, placeRoadPath, demolish } from './world';
import { primaryCity } from './city';
import { harbourPlacement } from './founding';
import { foundSecondCity, spotForInCity } from './testing';
import { buildStarterNeighbourhood } from './scenario';
import { footprintTiles, mapOf } from './grid';
import { foreignOccupancy } from './occupancy';
import { ISLAND_COUNT, tileAtOn, tileIndexOn } from './island';
import type { City, World } from './types';

function twoCities(seed = 1): { world: World; city1: City; city2: City } {
  const world = createWorld(seed, 0);
  const city1 = primaryCity(world);
  const city2 = foundSecondCity(world, (city1.home + 1) % ISLAND_COUNT);
  return { world, city1, city2 };
}

describe('foreignOccupancy', () => {
  test('is empty with a single city', () => {
    const world = createWorld(1);
    const occupancy = foreignOccupancy(world, primaryCity(world));
    expect(occupancy.roads.size).toBe(0);
    expect(occupancy.buildings.size).toBe(0);
  });

  test('reports the other city\'s roads and harbour, from either side', () => {
    const { world, city1, city2 } = twoCities();
    expect(buildStarterNeighbourhood(world, city2).ok).toBe(true);

    const fromCity1 = foreignOccupancy(world, city1);
    expect(city2.roads.every((tile) => fromCity1.roads.has(tile))).toBe(true);
    for (const tile of footprintTiles(mapOf(world, city2), city2.harbour)) expect(fromCity1.buildings.has(tile)).toBe(true);

    const fromCity2 = foreignOccupancy(world, city2);
    expect(city1.roads.every((tile) => fromCity2.roads.has(tile))).toBe(true);
  });
});

describe('a city builds only on its own island', () => {
  test('placement, roads and harbours all refuse another city\'s island', () => {
    const { world, city1, city2 } = twoCities();
    const spot = spotForInCity(world, city2, 'house')!;
    const before = structuredClone(world);

    expect(placement(world, city1, 'house', spot.x, spot.z).ok).toBe(false);
    expect(build(world, city1, 'house', spot.x, spot.z).ok).toBe(false);
    expect(placeRoadPath(world, city1, [spot]).ok).toBe(false);
    expect(harbourPlacement(world, city2.harbour.x, city2.harbour.z, city2.harbour.rotation, city1).ok).toBe(false);
    expect(world).toEqual(before);
  });

  test('two cities on their own islands keep every entity id unique and both economies running', () => {
    const { world, city1, city2 } = twoCities();
    expect(buildStarterNeighbourhood(world, city1).ok).toBe(true);
    expect(buildStarterNeighbourhood(world, city2).ok).toBe(true);
    const ids = [
      ...world.cities.flatMap((city) => [city.harbour.id, ...city.buildings.map((building) => building.id), ...city.walkers.map((walker) => walker.id)]),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(city1.buildings.length).toBe(city2.buildings.length);
  });
});

describe('demolition stays city-local', () => {
  test('a city demolishes its own road and leaves the other city untouched', () => {
    const { world, city1, city2 } = twoCities();
    const map = mapOf(world, city1);
    const road = tileAtOn(map, city1.roads[0]);
    const before = structuredClone(city2);

    expect(demolish(world, city1, road.x, road.z).ok).toBe(true);
    expect(city1.roads).not.toContain(tileIndexOn(map, road.x, road.z));
    expect(city2).toEqual(before);
  });
});
