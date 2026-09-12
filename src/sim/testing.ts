import type { ActionResult, Building, BuildingKind, BuildTool, City, Rotation, Tile, World } from './types';
import { STARTING_MONEY, footprint } from './catalog';
import { buildable, islandFor, landingRoads, levelOn, terrainOn, tileAtOn, tileIndexOn, type IslandMap, type IslandPlacement } from './island';
import { mapOf as gridMapOf, neighbours, perimeterTiles, footprintTiles } from './grid';
import { freshHarbour, harbourTiles } from './harbour';
import { placement, placeRoadPath, recomputeConnectivity } from './world';
import { primaryCity } from './city';

export function mapOf(world: World): IslandMap {
  return gridMapOf(world, primaryCity(world));
}

export function foundSecondCity(world: World, home: number, founded = true): City {
  const map = islandFor(world.seed, home);
  const city: City = {
    id: world.nextCityId++,
    home: map.home,
    founded,
    money: STARTING_MONEY,
    harbour: { ...freshHarbour(world.seed, landingRoads(map), map.home), id: world.nextId++ },
    produced: 0,
    delivered: 0,
    roads: landingRoads(map),
    buildings: [],
    walkers: [],
  };
  world.cities.push(city);
  recomputeConnectivity(world, city);
  return city;
}

export function homeIsland(world: World): IslandPlacement {
  const map = mapOf(world);
  return map.islands[map.home];
}

export function homeTilesInCity(world: World, city: City, predicate: (map: IslandMap, x: number, z: number) => boolean): Tile[] {
  const map = gridMapOf(world, city);
  const island = map.islands[city.home];
  const tiles: Tile[] = [];
  for (let z = island.z; z < island.z + island.depth; z++) {
    for (let x = island.x; x < island.x + island.width; x++) {
      if (predicate(map, x, z)) tiles.push({ x, z });
    }
  }
  return tiles;
}

export function homeTiles(world: World, predicate: (map: IslandMap, x: number, z: number) => boolean): Tile[] {
  return homeTilesInCity(world, primaryCity(world), predicate);
}

export function onHomeIsland(world: World, x: number, z: number): boolean {
  const island = homeIsland(world);
  return x >= island.x && z >= island.z && x < island.x + island.width && z < island.z + island.depth;
}

function findTileInCity(world: World, city: City, predicate: (map: IslandMap, x: number, z: number) => boolean, near?: Tile): Tile | null {
  const map = gridMapOf(world, city);
  const centre = near ?? map.entry;
  const reach = Math.max(map.width, map.depth);
  for (let radius = 0; radius <= reach; radius++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const x = centre.x + dx;
        const z = centre.z + dz;
        if (x < 0 || z < 0 || x >= map.width || z >= map.depth) continue;
        if (predicate(map, x, z)) return { x, z };
      }
    }
  }
  return null;
}

export function findTile(world: World, predicate: (map: IslandMap, x: number, z: number) => boolean, near?: Tile): Tile | null {
  return findTileInCity(world, primaryCity(world), predicate, near);
}

export function spotForInCity(world: World, city: City, kind: BuildTool, near?: Tile, rotation: Rotation = 0): Tile | null {
  return findTileInCity(world, city, (_map, x, z) => placement(world, city, kind, x, z, rotation).ok, near);
}

export function spotFor(world: World, kind: BuildTool, near?: Tile, rotation: Rotation = 0): Tile | null {
  return spotForInCity(world, primaryCity(world), kind, near, rotation);
}

export function freshRoadSpot(world: World, near?: Tile): Tile | null {
  const city = primaryCity(world);
  const map = mapOf(world);
  return findTile(world, (_map, x, z) => {
    if (city.roads.includes(tileIndexOn(map, x, z))) return false;
    return placement(world, city, 'road', x, z).ok;
  }, near);
}

export function farCorner(world: World): Tile {
  const island = homeIsland(world);
  return {
    x: island.entry.x > island.x + island.width / 2 ? island.x + 2 : island.x + island.width - 3,
    z: island.entry.z > island.z + island.depth / 2 ? island.z + 2 : island.z + island.depth - 3,
  };
}

function placeholderBuilding(kind: BuildingKind, rotation: Rotation, x: number, z: number): Building {
  return {
    id: 0, x, z, kind, rotation, tier: 1, residents: 0, food: 0, water: 0, condition: 100, stores: {},
    progress: 0, workers: 0, vendorEnabled: false, vendorInstalled: false, connected: false, serviceTimer: 0, upgradeTimer: 0,
  };
}

export function spotAdjacentTo(world: World, kind: Exclude<BuildingKind, 'harbour'>, tile: Tile, rotation: Rotation = 0): Tile | null {
  const city = primaryCity(world);
  const map = mapOf(world);
  const { width, depth } = footprint(kind, rotation);
  const target = tileIndexOn(map, tile.x, tile.z);
  for (let dz = -depth; dz <= 1; dz++) {
    for (let dx = -width; dx <= 1; dx++) {
      const x = tile.x + dx;
      const z = tile.z + dz;
      if (x < 0 || z < 0 || x + width > map.width || z + depth > map.depth) continue;
      if (!perimeterTiles(map, placeholderBuilding(kind, rotation, x, z)).includes(target)) continue;
      if (placement(world, city, kind, x, z, rotation).ok) return { x, z };
    }
  }
  return null;
}

export function unevenFootprint(world: World, kind: BuildingKind, rotation: Rotation = 0): Tile | null {
  const map = mapOf(world);
  const { width, depth } = footprint(kind, rotation);
  const home = homeIsland(world);
  for (let z = home.z; z <= home.z + home.depth - depth; z++) {
    for (let x = home.x; x <= home.x + home.width - width; x++) {
      const base = levelOn(map, x, z);
      let uneven = false;
      for (let dz = 0; dz < depth && !uneven; dz++) {
        for (let dx = 0; dx < width && !uneven; dx++) {
          if (levelOn(map, x + dx, z + dz) !== base) uneven = true;
        }
      }
      if (uneven) return { x, z };
    }
  }
  return null;
}

function passableForRoad(world: World, city: City, map: IslandMap, roads: Set<number>, tile: number): boolean {
  if (roads.has(tile)) return true;
  if (harbourTiles(world, city).includes(tile)) return false;
  const { x, z } = tileAtOn(map, tile);
  const terrain = terrainOn(map, x, z);
  if (!(buildable(terrain) || terrain === 'forest')) return false;
  return !city.buildings.some((candidate) => footprintTiles(map, candidate).includes(tile));
}

function reconstruct(cameFrom: Map<number, number>, goal: number): number[] {
  const path: number[] = [];
  let node = goal;
  while (node !== -1) {
    path.push(node);
    node = cameFrom.get(node) ?? -1;
  }
  return path.reverse();
}

function routeToRoad(world: World, city: City, map: IslandMap, roads: Set<number>, start: number): number[] | null {
  if (roads.has(start)) return [start];
  if (!passableForRoad(world, city, map, roads, start)) return null;
  const cameFrom = new Map<number, number>([[start, -1]]);
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const { x, z } = tileAtOn(map, current);
    for (const next of neighbours(map, current)) {
      if (cameFrom.has(next) || !passableForRoad(world, city, map, roads, next)) continue;
      const { x: nx, z: nz } = tileAtOn(map, next);
      if (levelOn(map, nx, nz) !== levelOn(map, x, z)) continue;
      cameFrom.set(next, current);
      if (roads.has(next)) return reconstruct(cameFrom, next);
      queue.push(next);
    }
  }
  return null;
}

export function connectInCity(world: World, city: City, building: Building): ActionResult {
  const map = gridMapOf(world, city);
  const roads = new Set(city.roads);
  let best: number[] | null = null;
  for (const start of perimeterTiles(map, building)) {
    const path = routeToRoad(world, city, map, roads, start);
    if (path && (!best || path.length < best.length)) best = path;
  }
  if (!best) return { ok: false, reason: 'No route to the road network.' };
  return placeRoadPath(world, city, best.map((tile) => tileAtOn(map, tile)));
}

export function connect(world: World, building: Building): ActionResult {
  return connectInCity(world, primaryCity(world), building);
}

export function isolatedRoadPair(world: World, near: Tile): [Tile, Tile] | null {
  const map = mapOf(world);
  const first = findTile(world, (candidateMap, x, z) => {
    if (!buildable(terrainOn(candidateMap, x, z))) return false;
    if (primaryCity(world).roads.includes(tileIndexOn(candidateMap, x, z))) return false;
    return secondOf(candidateMap, x, z) !== null;
  }, near);
  if (!first) return null;
  const second = secondOf(map, first.x, first.z);
  return second ? [first, second] : null;

  function secondOf(candidateMap: IslandMap, x: number, z: number): Tile | null {
    for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= candidateMap.width || nz >= candidateMap.depth) continue;
      if (primaryCity(world).roads.includes(tileIndexOn(candidateMap, nx, nz))) continue;
      if (!buildable(terrainOn(candidateMap, nx, nz))) continue;
      if (levelOn(candidateMap, nx, nz) !== levelOn(candidateMap, x, z)) continue;
      return { x: nx, z: nz };
    }
    return null;
  }
}

export const SLOPE_SEED = 913_047;

export function slopeFixture(): { low: Tile; high: Tile; landing: Tile } {
  const map = islandFor(SLOPE_SEED);
  const home = map.islands[map.home];
  const low: Tile = { x: home.x + 2, z: home.z + 2 };
  const high: Tile = { x: home.x + 3, z: home.z + 2 };
  const landing: Tile = { x: home.x + 4, z: home.z + 2 };
  const lowIndex = tileIndexOn(map, low.x, low.z);
  const highIndex = tileIndexOn(map, high.x, high.z);
  const landingIndex = tileIndexOn(map, landing.x, landing.z);
  map.terrain[lowIndex] = 'grass';
  map.terrain[highIndex] = 'grass';
  map.terrain[landingIndex] = 'grass';
  map.level[lowIndex] = 0;
  map.level[highIndex] = 1;
  map.level[landingIndex] = 1;
  return { low, high, landing };
}
