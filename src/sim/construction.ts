import type { BuildingKind, Rotation, Tile, World } from './types';
import { BUILDINGS, footprint, VENDOR_COST } from './catalog';
import { buildable, insideMapOn, levelOn, terrainOn, tileIndexOn, type IslandMap } from './island';
import { bfsShortest, entryTileIndex, footprintTiles as buildingFootprintTiles, mapOf } from './grid';
import { doorTiles, stairLayout } from './stairs';

export interface FootprintTile extends Tile { blocked: boolean; }

export interface DemolitionPreview {
  tile: number;
  buildingId: number | null;
  kind: BuildingKind | 'road';
  refund: number;
  footprint: number[];
}

function buildingOccupancy(map: IslandMap, world: World): Set<number> {
  const occupied = new Set<number>();
  for (const building of [...world.buildings, world.harbour]) for (const tile of buildingFootprintTiles(map, building)) occupied.add(tile);
  return occupied;
}

export function suitableFarmGround(world: World): Tile[] {
  const map = mapOf(world);
  const occupied = buildingOccupancy(map, world);
  for (const road of world.roads) occupied.add(road);
  const tiles: Tile[] = [];
  for (let z = 0; z < map.depth; z++) {
    for (let x = 0; x < map.width; x++) {
      if (terrainOn(map, x, z) !== 'fertile') continue;
      if (occupied.has(tileIndexOn(map, x, z))) continue;
      tiles.push({ x, z });
    }
  }
  return tiles;
}

export function footprintTileIssues(world: World, tool: BuildingKind, x: number, z: number, rotation: Rotation): FootprintTile[] {
  const map = mapOf(world);
  const { width, depth } = footprint(tool, rotation);
  const baseLevel = levelOn(map, x, z);
  const occupiedByBuilding = buildingOccupancy(map, world);
  const roads = new Set(world.roads);
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
      const blocked = wrongTerrain || unevenGround || roads.has(index) || occupiedByBuilding.has(index);
      tiles.push({ x: tx, z: tz, blocked });
    }
  }
  return tiles;
}

function accessPoints(world: World, tileIndices: number[]): number[] {
  const map = mapOf(world);
  const roads = new Set(world.roads);
  const own = new Set(tileIndices);
  const stairs = stairLayout(map, roads);
  const points = new Set<number>();
  for (const tile of own) if (roads.has(tile)) points.add(tile);
  for (const tile of doorTiles(map, stairs, own)) if (roads.has(tile)) points.add(tile);
  return [...points];
}

export function harbourRoute(world: World, tileIndices: number[]): number[] | null {
  const map = mapOf(world);
  const roads = new Set(world.roads);
  const entry = entryTileIndex(world);
  if (!roads.has(entry) || tileIndices.length === 0) return null;
  const goals = new Set(accessPoints(world, tileIndices));
  if (goals.size === 0) return null;
  return bfsShortest(map, roads, entry, (tile) => goals.has(tile));
}

export function demolitionPreview(world: World, x: number, z: number): DemolitionPreview | null {
  const map = mapOf(world);
  if (!insideMapOn(map, x, z)) return null;
  const tile = tileIndexOn(map, x, z);
  const building = world.buildings.find((candidate) => buildingFootprintTiles(map, candidate).includes(tile));
  if (building) {
    const refund = Math.floor((BUILDINGS[building.kind].cost + (building.vendorInstalled ? VENDOR_COST : 0)) / 2);
    return { tile, buildingId: building.id, kind: building.kind, refund, footprint: buildingFootprintTiles(map, building) };
  }
  if (world.roads.includes(tile)) return { tile, buildingId: null, kind: 'road', refund: 0, footprint: [tile] };
  return null;
}
