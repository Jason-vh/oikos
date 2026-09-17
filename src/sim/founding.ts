import type { Building, City, Placement, Rotation, Tile, World } from './types';
import { footprint } from './catalog';
import { buildable, insideMapOn, islandAt, islandFor, levelOn, terrainOn, tileAtOn, tileIndexOn, type IslandMap, type IslandPlacement } from './island';
import { foreignOccupancy } from './occupancy';

export const HARBOUR_WIDTH = 2;
export const HARBOUR_LAND_DEPTH = 2;
export const HARBOUR_WATER_DEPTH = 3;

const SEAWARD: Record<Rotation, Tile> = {
  0: { x: 0, z: 1 },
  1: { x: -1, z: 0 },
  2: { x: 0, z: -1 },
  3: { x: 1, z: 0 },
};

export interface HarbourSite {
  land: Tile[];
  water: Tile[];
  offshore: Tile[];
}

export function harbourSite(x: number, z: number, rotation: Rotation): HarbourSite {
  const seaward = SEAWARD[rotation];
  const along = { x: Math.abs(seaward.z), z: Math.abs(seaward.x) };
  const { width, depth } = footprint('harbour', rotation);
  const start = {
    x: x + (seaward.x < 0 ? width - 1 : 0),
    z: z + (seaward.z < 0 ? depth - 1 : 0),
  };
  const rows = HARBOUR_LAND_DEPTH + HARBOUR_WATER_DEPTH;
  const site: HarbourSite = { land: [], water: [], offshore: [] };
  for (let row = 0; row < rows; row++) {
    for (let step = 0; step < HARBOUR_WIDTH; step++) {
      const tile = {
        x: start.x + seaward.x * row + along.x * step,
        z: start.z + seaward.z * row + along.z * step,
      };
      if (row < HARBOUR_LAND_DEPTH) site.land.push(tile);
      else site.water.push(tile);
      if (row === rows - 1) site.offshore.push(tile);
    }
  }
  return site;
}

export function harbourApron(x: number, z: number, rotation: Rotation): Tile[] {
  const seaward = SEAWARD[rotation];
  return harbourSite(x, z, rotation).land
    .filter((_, index) => index < HARBOUR_WIDTH)
    .map((tile) => ({ x: tile.x - seaward.x, z: tile.z - seaward.z }));
}

export function harbourSiteOf(building: Building): HarbourSite {
  return harbourSite(building.x, building.z, building.rotation);
}

export function harbourLandTiles(map: IslandMap, building: Building): number[] {
  return harbourSiteOf(building).land.map((tile) => tileIndexOn(map, tile.x, tile.z));
}

export function harbourIslandAt(map: IslandMap, x: number, z: number, rotation: Rotation): IslandPlacement | null {
  const islands = harbourSite(x, z, rotation).land.map((tile) => islandAt(map, tile.x, tile.z));
  const first = islands[0];
  if (!first || islands.some((island) => island !== first)) return null;
  return first;
}

function unfitQuayTiles(map: IslandMap, site: HarbourSite): Tile[] {
  return site.land.filter((tile) => !buildable(terrainOn(map, tile.x, tile.z)) || levelOn(map, tile.x, tile.z) !== 0);
}

function unfitPierTiles(map: IslandMap, site: HarbourSite): Tile[] {
  return site.water.filter((tile) => terrainOn(map, tile.x, tile.z) !== 'water');
}

export function harbourPlacement(world: World, x: number, z: number, rotation: Rotation, city: City | null = null): Placement {
  const map = islandFor(world.seed);
  const site = harbourSite(x, z, rotation);
  const all = [...site.land, ...site.water];
  if (all.some((tile) => !insideMapOn(map, tile.x, tile.z))) return { ok: false, reason: 'Out of bounds.', cost: 0, tiles: [] };
  const occupied = all.map((tile) => tileIndexOn(map, tile.x, tile.z));
  const reject = (reason: string, blocked: Tile[] = []): Placement => ({
    ok: false,
    reason,
    cost: 0,
    tiles: occupied,
    blocked: blocked.map((tile) => tileIndexOn(map, tile.x, tile.z)),
  });

  const unfitQuay = unfitQuayTiles(map, site);
  if (unfitQuay.length) return reject('The quay needs flat, open shore.', unfitQuay);
  const unfitPier = unfitPierTiles(map, site);
  if (unfitPier.length) return reject('The pier needs open water in front of the quay.', unfitPier);

  const island = harbourIslandAt(map, x, z, rotation);
  if (!island) return reject('A harbour stands at the shore of one island.');
  const owner = world.cities.find((candidate) => map.islands[candidate.home] === island);
  if (owner && owner !== city) return reject('That island already belongs to another city.');

  const foreign = foreignOccupancy(world, city?.id ?? null);
  const roads = new Set(city?.roads ?? []);
  for (const tile of occupied) {
    if (foreign.roads.has(tile) || foreign.buildings.has(tile)) return reject('Another city already holds that ground.', [tileAtOn(map, tile)]);
    if (roads.has(tile)) return reject('Place the harbour beside the road, not on it.', [tileAtOn(map, tile)]);
  }
  return { ok: true, reason: '', cost: 0, tiles: occupied };
}

function openBehind(map: IslandMap, x: number, z: number, rotation: Rotation): boolean {
  const seaward = SEAWARD[rotation];
  const apron = harbourApron(x, z, rotation);
  for (let step = 0; step < 4; step++) {
    for (const tile of apron) {
      const inland = { x: tile.x - seaward.x * step, z: tile.z - seaward.z * step };
      if (!insideMapOn(map, inland.x, inland.z)) return false;
      if (!buildable(terrainOn(map, inland.x, inland.z)) || levelOn(map, inland.x, inland.z) !== 0) return false;
    }
  }
  return true;
}

export function findHarbourSite(map: IslandMap, home: number): { x: number; z: number; rotation: Rotation } | null {
  const island = map.islands[home];
  for (let radius = 0; radius <= 40; radius++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const x = island.entry.x + dx;
        const z = island.entry.z + dz;
        for (const rotation of [0, 3, 1, 2] as Rotation[]) {
          const site = harbourSite(x, z, rotation);
          if ([...site.land, ...site.water].some((tile) => !insideMapOn(map, tile.x, tile.z))) continue;
          if (unfitQuayTiles(map, site).length || unfitPierTiles(map, site).length) continue;
          if (harbourIslandAt(map, x, z, rotation) !== island) continue;
          if (!openBehind(map, x, z, rotation)) continue;
          return { x, z, rotation };
        }
      }
    }
  }
  return null;
}
