import type { City, World } from './types';
import { STARTING_MONEY } from './catalog';
import { freshHarbour } from './harbour';
import { footprintTiles } from './grid';
import { ISLAND_COUNT, islandAt, islandFor, landingRoads, tileAtOn } from './island';

export interface ClaimResult { ok: boolean; reason: string; city: City | null; }

function islandHeldByAnotherCity(world: World, home: number): boolean {
  const map = islandFor(world.seed);
  const target = map.islands[home];
  const onTarget = (tile: number) => {
    const { x, z } = tileAtOn(map, tile);
    return islandAt(map, x, z) === target;
  };
  return world.cities.some((city) => {
    if (city.roads.some(onTarget)) return true;
    if (city.buildings.some((building) => footprintTiles(map, building).some(onTarget))) return true;
    return city.founded && footprintTiles(map, city.harbour).some(onTarget);
  });
}

export function claimIsland(world: World, home: number): ClaimResult {
  if (!Number.isInteger(home) || home < 0 || home >= ISLAND_COUNT) return { ok: false, reason: 'Unknown starting island.', city: null };
  if (world.cities.some((city) => city.home === home)) return { ok: false, reason: 'That island is already claimed.', city: null };
  if (islandHeldByAnotherCity(world, home)) return { ok: false, reason: 'That island already holds another city\'s infrastructure.', city: null };
  if (world.nextCityId >= Number.MAX_SAFE_INTEGER || world.nextId >= Number.MAX_SAFE_INTEGER) return { ok: false, reason: 'No safe ids remain to claim another city.', city: null };

  const map = islandFor(world.seed, home);
  const roads = landingRoads(map);
  const city: City = {
    id: world.nextCityId++,
    home,
    founded: false,
    money: STARTING_MONEY,
    harbour: { ...freshHarbour(world.seed, roads, home), id: world.nextId++ },
    produced: 0,
    delivered: 0,
    roads,
    buildings: [],
    walkers: [],
  };
  world.cities.push(city);
  return { ok: true, reason: 'Island claimed.', city };
}
