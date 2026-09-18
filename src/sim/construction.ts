import type { BuildingKind, City, Rotation, Tile, World } from './types';
import { BUILDINGS, footprint, VENDOR_COST } from './catalog';
import { buildable, insideMapOn, levelOn, onHomeIsland, terrainOn, tileIndexOn, type IslandMap } from './island';
import { bfsShortest, footprintTiles as buildingFootprintTiles, mapOf } from './grid';
import { harbourGate } from './world';
import { doorTiles, stairLayout } from './stairs';
import { foreignOccupancy } from './occupancy';
import { stallsInstalled } from './stalls';
import { cropTiles } from './crops';

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
  const buildings = [...city.buildings, city.harbour];
  for (const building of buildings) for (const tile of buildingFootprintTiles(map, building)) occupied.add(tile);
  return occupied;
}

export function footprintTileIssues(world: World, city: City, tool: BuildingKind, x: number, z: number, rotation: Rotation): FootprintTile[] {
  const map = mapOf(world, city);
  const { width, depth } = footprint(tool, rotation);
  const baseLevel = levelOn(map, x, z);
  const occupiedByBuilding = buildingOccupancy(map, city);
  const sown = cropTiles(world);
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
      const wrongTerrain = !buildable(terrain);
      const unevenGround = levelOn(map, tx, tz) !== baseLevel;
      const index = tileIndexOn(map, tx, tz);
      const blocked = !onHomeIsland(map, tx, tz) || wrongTerrain || unevenGround || roads.has(index) || occupiedByBuilding.has(index) || sown.has(index);
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
  const gate = harbourGate(world, city);
  if (gate === null || tileIndices.length === 0) return null;
  const goals = new Set(accessPoints(world, city, tileIndices));
  if (goals.size === 0) return null;
  return bfsShortest(map, roads, gate, (tile) => goals.has(tile));
}

export function demolitionPreview(world: World, city: City, x: number, z: number): DemolitionPreview | null {
  const map = mapOf(world, city);
  if (!insideMapOn(map, x, z)) return null;
  const tile = tileIndexOn(map, x, z);
  const building = city.buildings.find((candidate) => buildingFootprintTiles(map, candidate).includes(tile));
  if (building) {
    const refund = Math.floor((BUILDINGS[building.kind].cost + stallsInstalled(building.stalls) * VENDOR_COST) / 2);
    return { tile, buildingId: building.id, kind: building.kind, refund, footprint: buildingFootprintTiles(map, building) };
  }
  if (city.roads.includes(tile)) return { tile, buildingId: null, kind: 'road', refund: 0, footprint: [tile] };
  return null;
}
