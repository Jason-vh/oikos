import type { Building, BuildingKind, City, Crop, CropKind, Placement, Rotation, Tile, World } from './types';
import { BUILDINGS } from './catalog';
import { CROP_GROW_SECONDS, CROP_YIELD, FARM_STOCK_CAP, FIELD_RANGE, FIELDS_TENDED } from './balance';
import { buildable, hash, insideMapOn, terrainOn, tileAtOn, tileIndexOn, type IslandMap } from './island';
import { footprintTiles, mapOf, perimeterTiles, siteBuilding } from './grid';
import { mixedEdgeAllowed, stairLayout, type Stair } from './stairs';
import { addStore, totalStock } from './world';

export const CROP_KINDS: CropKind[] = ['wheat', 'olives'];

const GROWERS: Record<CropKind, BuildingKind> = { wheat: 'farm', olives: 'orchard' };

export const CROP_REASON = {
  needsFertileGround: 'Crops root only in fertile soil.',
  outOfReach: 'Too far from the farmstead for anyone to tend.',
  tileTaken: 'That ground is already spoken for.',
  alreadySown: 'Something already grows there.',
  notAGrower: 'Only a farm or an orchard sows fields.',
  nothingSown: 'Nothing planted there.',
} as const;

export function cropOf(kind: BuildingKind): CropKind | null {
  if (kind === 'farm') return 'wheat';
  if (kind === 'orchard') return 'olives';
  return null;
}

export function growerOf(crop: CropKind): BuildingKind {
  return GROWERS[crop];
}

export function isGrower(kind: BuildingKind): boolean {
  return cropOf(kind) !== null;
}

export function fieldCapacity(kind: BuildingKind): number {
  return FIELDS_TENDED[kind as 'farm' | 'orchard'] ?? 0;
}

export function cropAt(city: City, tile: number): Crop | undefined {
  return city.crops.find((crop) => crop.tile === tile);
}

export function cropTiles(world: World, except: City | null = null): Set<number> {
  const taken = new Set<number>();
  for (const city of world.cities) {
    if (except && city.id === except.id) continue;
    for (const crop of city.crops) taken.add(crop.tile);
  }
  return taken;
}

function walkable(map: IslandMap, blocked: ReadonlySet<number>, roads: ReadonlySet<number>, tile: number): boolean {
  if (blocked.has(tile)) return false;
  if (roads.has(tile)) return true;
  const { x, z } = tileAtOn(map, tile);
  const terrain = terrainOn(map, x, z);
  return buildable(terrain) || terrain === 'forest' || terrain === 'cliff';
}

function buildingTiles(world: World): Set<number> {
  const map = mapOf(world, world.cities[0]);
  const tiles = new Set<number>();
  for (const city of world.cities) {
    for (const building of [...city.buildings, city.harbour]) {
      for (const tile of footprintTiles(map, building)) tiles.add(tile);
    }
  }
  return tiles;
}

interface Tending {
  map: IslandMap;
  roads: Set<number>;
  stairs: ReadonlyMap<number, Stair>;
  blocked: Set<number>;
}

function tendingGround(world: World, city: City): Tending {
  const map = mapOf(world, city);
  const roads = new Set(city.roads);
  return { map, roads, stairs: stairLayout(map, roads), blocked: buildingTiles(world) };
}

function fieldOrigins(building: Building, ground: Tending): number[] {
  return perimeterTiles(ground.map, building).filter((tile) => walkable(ground.map, ground.blocked, ground.roads, tile));
}

function walkedTiles(ground: Tending, origins: readonly number[], range: number): Map<number, number> {
  const { map, roads, stairs, blocked } = ground;
  const distance = new Map<number, number>();
  const queue = [...origins];
  for (const origin of origins) distance.set(origin, 0);
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const step = distance.get(current)!;
    if (step >= range) continue;
    const { x, z } = tileAtOn(map, current);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (!insideMapOn(map, nx, nz)) continue;
      const next = tileIndexOn(map, nx, nz);
      if (distance.has(next)) continue;
      if (!walkable(map, blocked, roads, next) || !mixedEdgeAllowed(map, roads, stairs, current, next)) continue;
      distance.set(next, step + 1);
      queue.push(next);
    }
  }
  return distance;
}

function reachOf(building: Building, ground: Tending): Map<number, number> {
  const origins = fieldOrigins(building, ground);
  if (origins.length === 0) return new Map();
  const walked = walkedTiles(ground, origins, FIELD_RANGE);
  for (const tile of footprintTiles(ground.map, building)) walked.delete(tile);
  return walked;
}

export function fieldReach(world: World, city: City, building: Building): number[] {
  if (!isGrower(building.kind)) return [];
  return [...reachOf(building, tendingGround(world, city)).keys()];
}

function sowable(world: World, city: City, tile: number): string {
  const map = mapOf(world, city);
  const { x, z } = tileAtOn(map, tile);
  if (!insideMapOn(map, x, z)) return CROP_REASON.tileTaken;
  if (terrainOn(map, x, z) !== 'fertile') return CROP_REASON.needsFertileGround;
  if (cropTiles(world).has(tile)) return CROP_REASON.alreadySown;
  if (city.roads.includes(tile)) return CROP_REASON.tileTaken;
  if (world.cities.some((other) => other.roads.includes(tile))) return CROP_REASON.tileTaken;
  if (buildingTiles(world).has(tile)) return CROP_REASON.tileTaken;
  return '';
}

export function plantPlacement(world: World, city: City, building: Building, tiles: Tile[]): Placement {
  if (!isGrower(building.kind)) return { ok: false, reason: CROP_REASON.notAGrower, cost: 0, tiles: [] };
  const map = mapOf(world, city);
  const reach = reachOf(building, tendingGround(world, city));
  const wanted: number[] = [];
  const blocked: number[] = [];
  for (const { x, z } of tiles) {
    if (!insideMapOn(map, x, z)) continue;
    const tile = tileIndexOn(map, x, z);
    if (wanted.includes(tile) || blocked.includes(tile)) continue;
    if (!reach.has(tile) || sowable(world, city, tile) !== '') blocked.push(tile);
    else wanted.push(tile);
  }
  if (wanted.length === 0) {
    const first = tiles[0] ? tileIndexOn(map, tiles[0].x, tiles[0].z) : -1;
    const reason = first >= 0 && !reach.has(first) ? CROP_REASON.outOfReach : sowable(world, city, first) || CROP_REASON.alreadySown;
    return { ok: false, reason, cost: 0, tiles: [], blocked };
  }
  return { ok: true, reason: '', cost: 0, tiles: wanted, blocked };
}

export function plant(world: World, city: City, id: number, tiles: Tile[]): Placement {
  const building = city.buildings.find((candidate) => candidate.id === id);
  if (!building) return { ok: false, reason: CROP_REASON.notAGrower, cost: 0, tiles: [] };
  const result = plantPlacement(world, city, building, tiles);
  if (!result.ok) return result;
  const crop = cropOf(building.kind)!;
  for (const tile of result.tiles) {
    city.crops.push({ tile, kind: crop, progress: hash(tile, building.id, world.seed + 3167) * .25 });
  }
  return { ...result, reason: result.tiles.length === 1 ? 'Sown.' : `${result.tiles.length} fields sown.` };
}

export function uproot(city: City, tile: number): boolean {
  const index = city.crops.findIndex((crop) => crop.tile === tile);
  if (index === -1) return false;
  city.crops.splice(index, 1);
  return true;
}

export function openFieldsAt(world: World, city: City, kind: BuildingKind, x: number, z: number, rotation: Rotation = 0): number[] {
  if (!isGrower(kind)) return [];
  return openFields(world, city, siteBuilding(kind, rotation, x, z));
}

export function openFields(world: World, city: City, building: Building): number[] {
  if (!isGrower(building.kind)) return [];
  const reach = reachOf(building, tendingGround(world, city));
  return [...reach]
    .filter(([tile]) => sowable(world, city, tile) === '')
    .sort((one, other) => one[1] - other[1] || one[0] - other[0])
    .map(([tile]) => tile);
}

export function sowFields(world: World, city: City, building: Building): number {
  const map = mapOf(world, city);
  const reach = new Set(fieldReach(world, city, building));
  const already = city.crops.filter((crop) => crop.kind === cropOf(building.kind) && reach.has(crop.tile)).length;
  const room = fieldCapacity(building.kind) - already;
  const wanted = openFields(world, city, building).slice(0, Math.max(0, room)).map((tile) => tileAtOn(map, tile));
  if (wanted.length === 0) return 0;
  const sown = plant(world, city, building.id, wanted);
  return sown.ok ? sown.tiles.length : 0;
}

export function tendedFields(world: World, city: City): Map<number, number[]> {
  const ground = tendingGround(world, city);
  const claimed = new Set<number>();
  const byBuilding = new Map<number, number[]>();
  const growers = city.buildings.filter((building) => isGrower(building.kind));
  const crops = new Map(city.crops.map((crop) => [crop.tile, crop]));
  for (const grower of growers) {
    const wanted = cropOf(grower.kind)!;
    const capacity = fieldCapacity(grower.kind);
    const tended: number[] = [];
    if (grower.connected) {
      const reach = [...reachOf(grower, ground)]
        .filter(([tile]) => !claimed.has(tile) && crops.get(tile)?.kind === wanted)
        .sort((one, other) => one[1] - other[1] || one[0] - other[0]);
      for (const [tile] of reach.slice(0, capacity)) {
        claimed.add(tile);
        tended.push(tile);
      }
    }
    byBuilding.set(grower.id, tended);
  }
  return byBuilding;
}

export function updateFields(world: World, city: City, dt: number): void {
  const tended = tendedFields(world, city);
  const crops = new Map(city.crops.map((crop) => [crop.tile, crop]));
  for (const grower of city.buildings) {
    const fields = tended.get(grower.id);
    if (!fields || fields.length === 0 || grower.workers <= 0) continue;
    const staffing = grower.workers / BUILDINGS[grower.kind].jobs;
    for (const tile of fields) {
      const crop = crops.get(tile);
      if (!crop) continue;
      crop.progress += (dt / CROP_GROW_SECONDS[crop.kind]) * staffing;
      if (crop.progress < 1) continue;
      crop.progress -= 1;
      const room = Math.max(0, FARM_STOCK_CAP - totalStock(grower));
      const yielded = Math.min(CROP_YIELD, room);
      if (yielded <= 0) {
        crop.progress = 1;
        continue;
      }
      addStore(grower, crop.kind, yielded);
      city.produced += yielded;
    }
  }
}

export interface FieldReport {
  tended: number;
  capacity: number;
  planted: number;
  ripest: number;
}

export function fieldReport(world: World, city: City, building: Building): FieldReport {
  const wanted = cropOf(building.kind);
  if (!wanted) return { tended: 0, capacity: 0, planted: 0, ripest: 0 };
  const reach = new Set(fieldReach(world, city, building));
  const within = city.crops.filter((crop) => crop.kind === wanted && reach.has(crop.tile));
  const tended = tendedFields(world, city).get(building.id) ?? [];
  return {
    tended: tended.length,
    capacity: fieldCapacity(building.kind),
    planted: within.length,
    ripest: within.reduce((best, crop) => Math.max(best, crop.progress), 0),
  };
}

export function growerStatus(world: World, city: City, building: Building): string[] {
  const report = fieldReport(world, city, building);
  if (report.planted === 0) return ['No fields sown; plant some within the tending ring.'];
  if (report.tended === 0) return ['Fields sown, but nobody is tending them.'];
  const lines = [`Tending ${report.tended} of ${report.capacity} fields, ripest ${Math.round(report.ripest * 100)}%.`];
  if (report.planted > report.tended) lines.push(`${report.planted - report.tended} fields beyond what these hands can work.`);
  return lines;
}

export function harvestLevels(city: City): Map<number, number> {
  const levels = new Map<number, number>();
  for (const crop of city.crops) levels.set(crop.tile, crop.progress);
  return levels;
}
