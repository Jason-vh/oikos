import type { BuildingKind, City, Rotation, Tile, World } from './types';
import { BUILDINGS, footprint, VENDOR_COST } from './catalog';
import { buildable, insideMapOn, levelOn, onHomeIsland, terrainOn, tileIndexOn, type IslandMap } from './island';
import { bfsShortest, entryTileIndex, footprintTiles as buildingFootprintTiles, mapOf } from './grid';
import { doorTiles, stairLayout } from './stairs';
import { foreignOccupancy } from './occupancy';

export interface FootprintTile extends Tile { blocked: boolean; }

export interface DemolitionPreview {
  tile: number;
  buildingId: number | null;
  kind: BuildingKind | 'road';
  refund: number;
  footprint: number[];
}

function buildingOccupancy(map: IslandMap, city: City): Set<number> {
  const occupied = new Set<number>();
  const buildings = city.founded ? [...city.buildings, city.harbour] : city.buildings;
  for (const building of buildings) for (const tile of buildingFootprintTiles(map, building)) occupied.add(tile);
  return occupied;
}

export function suitableFarmGround(world: World, city: City): Tile[] {
  const map = mapOf(world, city);
  const occupied = buildingOccupancy(map, city);
  for (const road of city.roads) occupied.add(road);
  const foreign = foreignOccupancy(world, city);
  for (const tile of foreign.roads) occupied.add(tile);
  for (const tile of foreign.buildings) occupied.add(tile);
  const tiles: Tile[] = [];
  const home = map.islands[map.home];
  for (let z = home.z; z < home.z + home.depth; z++) {
    for (let x = home.x; x < home.x + home.width; x++) {
      if (terrainOn(map, x, z) !== 'fertile') continue;
      if (occupied.has(tileIndexOn(map, x, z))) continue;
      tiles.push({ x, z });
    }
  }
  return tiles;
}

export function footprintTileIssues(world: World, city: City, tool: BuildingKind, x: number, z: number, rotation: Rotation): FootprintTile[] {
  const map = mapOf(world, city);
  const { width, depth } = footprint(tool, rotation);
  const baseLevel = levelOn(map, x, z);
  const occupiedByBuilding = buildingOccupancy(map, city);
  const roads = new Set(city.roads);
  const foreign = foreignOccupancy(world, city);
  for (const tile of foreign.buildings) occupiedByBuilding.add(tile);
  for (const tile of foreign.roads) roads.add(tile);
  const tiles: FootprintTile[] = [];
  for (let dz = 0; dz < depth; dz++) {
    for (let dx = 0; dx < width; dx++) {
      const tx = x + dx;
      const tz = z + dz;
      if (!insideMapOn(map, tx, tz)) {
        tiles.push({ x: tx, z: tz, blocked: true });
        continue;
      }
      const terrain = terrainOn(map, tx, tz);
      const wrongTerrain = tool === 'farm' ? terrain !== 'fertile' : !buildable(terrain);
      const unevenGround = levelOn(map, tx, tz) !== baseLevel;
      const index = tileIndexOn(map, tx, tz);
      const blocked = !onHomeIsland(map, tx, tz) || wrongTerrain || unevenGround || roads.has(index) || occupiedByBuilding.has(index);
      tiles.push({ x: tx, z: tz, blocked });
    }
  }
  return tiles;
}

function accessPoints(world: World, city: City, tileIndices: number[]): number[] {
  const map = mapOf(world, city);
  const roads = new Set(city.roads);
  const own = new Set(tileIndices);
  const stairs = stairLayout(map, roads);
  const points = new Set<number>();
  for (const tile of own) if (roads.has(tile)) points.add(tile);
  for (const tile of doorTiles(map, stairs, own)) if (roads.has(tile)) points.add(tile);
  return [...points];
}

export function harbourRoute(world: World, city: City, tileIndices: number[]): number[] | null {
  const map = mapOf(world, city);
  const roads = new Set(city.roads);
  const entry = entryTileIndex(world, city);
  if (!roads.has(entry) || tileIndices.length === 0) return null;
  const goals = new Set(accessPoints(world, city, tileIndices));
  if (goals.size === 0) return null;
  return bfsShortest(map, roads, entry, (tile) => goals.has(tile));
}

export function demolitionPreview(world: World, city: City, x: number, z: number): DemolitionPreview | null {
  const map = mapOf(world, city);
  if (!insideMapOn(map, x, z)) return null;
  const tile = tileIndexOn(map, x, z);
  const building = city.buildings.find((candidate) => buildingFootprintTiles(map, candidate).includes(tile));
  if (building) {
    const refund = Math.floor((BUILDINGS[building.kind].cost + (building.vendorInstalled ? VENDOR_COST : 0)) / 2);
    return { tile, buildingId: building.id, kind: building.kind, refund, footprint: buildingFootprintTiles(map, building) };
  }
  if (city.roads.includes(tile)) return { tile, buildingId: null, kind: 'road', refund: 0, footprint: [tile] };
  return null;
}
