import type { City, ActionResult, Placement, World } from './types';
import { footprint } from './catalog';
import { accessDoors, bfsReachable, entryTileIndex, mapOf } from './grid';
import { buildable, insideMapOn, levelOn, onHomeIsland, terrainOn, tileIndexOn } from './island';
import { recomputeConnectivity } from './world';
import { foreignOccupancy } from './occupancy';

export const FOUNDING_RANGE = 16;

export function foundingPlacement(world: World, city: City, x: number, z: number): Placement {
  if (city.founded) return { ok: false, reason: 'This city already has its founding harbour.', cost: 0, tiles: [] };
  const map = mapOf(world, city);
  const { width, depth } = footprint('harbour');
  const tiles: number[] = [];
  for (let dz = 0; dz < depth; dz++) {
    for (let dx = 0; dx < width; dx++) {
      if (!insideMapOn(map, x + dx, z + dz)) return { ok: false, reason: 'Out of bounds.', cost: 0, tiles: [] };
      tiles.push(tileIndexOn(map, x + dx, z + dz));
    }
  }
  const reject = (reason: string): Placement => ({ ok: false, reason, cost: 0, tiles });
  if (!onHomeIsland(map, x, z) || !onHomeIsland(map, x + width - 1, z + depth - 1)) return reject('Choose a harbour site on your starting island.');
  if (Math.abs(x - map.entry.x) > FOUNDING_RANGE || map.entry.z - z > FOUNDING_RANGE || z + depth > map.entry.z) return reject('Place the dockyard beside the prepared landing road. H returns to the landing.');
  const roads = new Set(city.roads);
  const foreign = foreignOccupancy(world, city);
  for (const tile of tiles) {
    const tx = tile % map.width;
    const tz = Math.floor(tile / map.width);
    if (!buildable(terrainOn(map, tx, tz)) || levelOn(map, tx, tz) !== 0) return reject('The harbour needs flat, clear lowland.');
    if (roads.has(tile)) return reject('Place the harbour beside the road, not on it.');
    if (foreign.roads.has(tile) || foreign.buildings.has(tile)) return reject('Another city already holds that ground.');
  }
  const entry = entryTileIndex(world, city);
  const reachable = roads.has(entry) ? bfsReachable(map, roads, entry) : new Set<number>();
  const candidate = { ...city.harbour, x, z };
  if (!accessDoors(map, roads, candidate).some((tile) => reachable.has(tile))) return reject('The harbour needs a door onto the landing road.');
  return { ok: true, reason: '', cost: 0, tiles };
}

export function foundHarbour(world: World, city: City, x: number, z: number): ActionResult {
  const result = foundingPlacement(world, city, x, z);
  if (!result.ok) return { ok: false, reason: result.reason };
  city.harbour.x = x;
  city.harbour.z = z;
  city.founded = true;
  recomputeConnectivity(world, city);
  return { ok: true, reason: 'Your city is founded. Build homes beside the harbour road.' };
}
