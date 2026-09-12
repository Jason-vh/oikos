import type { Animal, AnimalKind, Building, BuildingKind, Resource, Stores, Walker, WalkerKind, World } from './types';

const ANIMAL_KINDS: AnimalKind[] = ['boar', 'rabbit', 'fish', 'gull'];

import { BUILDINGS, HOUSE_CAPACITY, RESOURCES, STARTING_MONEY } from './catalog';
import { buildable, islandFor, insideMapOn, landingRoads, levelOn, onHomeIsland, terrainOn, tileAtOn, type IslandMap } from './island';
import { neighbours } from './grid';
import { dropInvalidWalkers, recomputeConnectivity } from './world';
import { harbourAt, validateHarbourProgress } from './harbour';
import { ARCHIPELAGO_VERSION, CURRENT_VERSION, migrateSave } from './save-migrations';

export function serializeWorld(world: World): string {
  return JSON.stringify(world);
}

const BUILDING_KINDS: BuildingKind[] = ['house', 'farm', 'granary', 'agora', 'fountain', 'maintenance', 'lodge', 'woodcutter', 'stockpile', 'harbour'];
const WALKER_KINDS: WalkerKind[] = ['cart', 'buyer', 'vendor', 'water', 'maintenance', 'immigrant', 'hunter', 'woodcutter', 'porter'];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tileInBounds(map: IslandMap, tile: unknown): tile is number {
  return isInteger(tile) && tile >= 0 && tile < map.width * map.depth;
}

function validateRoads(map: IslandMap, raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<number>();
  for (const tile of raw) {
    if (!tileInBounds(map, tile)) return null;
    if (seen.has(tile)) return null;
    seen.add(tile);
  }
  return raw as number[];
}

function footprintFor(map: IslandMap, kind: BuildingKind, rotation: number, x: number, z: number): number[] | null {
  const definition = BUILDINGS[kind];
  if (!definition) return null;
  const swapped = rotation % 2 === 1;
  const width = swapped ? definition.depth : definition.width;
  const depth = swapped ? definition.width : definition.depth;
  const tiles: number[] = [];
  for (let dz = 0; dz < depth; dz++) {
    for (let dx = 0; dx < width; dx++) {
      const tx = x + dx;
      const tz = z + dz;
      if (!insideMapOn(map, tx, tz)) return null;
      tiles.push(tz * map.width + tx);
    }
  }
  return tiles;
}

function validateBuilding(map: IslandMap, raw: unknown, roads: Set<number>, occupied: Set<number>): Building | null {
  if (!isPlainObject(raw)) return null;
  const { id, x, z, kind, rotation, tier, residents, food, water, condition, stores, progress, workers, vendorEnabled, vendorInstalled, connected, serviceTimer, upgradeTimer } = raw;

  if (!isInteger(id) || id <= 0) return null;
  if (!isInteger(x) || !isInteger(z)) return null;
  if (typeof kind !== 'string' || !BUILDING_KINDS.includes(kind as BuildingKind)) return null;
  if (![0, 1, 2, 3].includes(rotation as number)) return null;
  if (![1, 2, 3].includes(tier as number)) return null;
  if (!isNonNegativeFinite(residents)) return null;
  if (!isNonNegativeFinite(food)) return null;
  if (!isNonNegativeFinite(water)) return null;
  if (!isFiniteNumber(condition) || condition < 0 || condition > 100) return null;
  const parsedStores = parseStores(stores);
  if (!parsedStores) return null;
  if (!isFiniteNumber(progress) || progress < 0 || progress >= 1) return null;
  if (!isNonNegativeFinite(workers)) return null;
  if (typeof vendorEnabled !== 'boolean') return null;
  if (typeof vendorInstalled !== 'boolean') return null;
  if (vendorEnabled && !vendorInstalled) return null;
  if (typeof connected !== 'boolean') return null;
  if (!isNonNegativeFinite(serviceTimer)) return null;
  if (!isNonNegativeFinite(upgradeTimer)) return null;

  const builtKind = kind as BuildingKind;
  const builtTier = tier as 1 | 2 | 3;
  if (builtKind === 'house' && (residents as number) > HOUSE_CAPACITY[builtTier]) return null;

  const tiles = footprintFor(map, builtKind, rotation as number, x as number, z as number);
  if (!tiles) return null;
  for (const tile of tiles) {
    if (roads.has(tile)) return null;
    if (occupied.has(tile)) return null;
    occupied.add(tile);
  }

  return {
    id: id as number,
    x: x as number,
    z: z as number,
    kind: builtKind,
    rotation: rotation as 0 | 1 | 2 | 3,
    tier: builtTier,
    residents: residents as number,
    food: food as number,
    water: water as number,
    condition: condition as number,
    stores: parsedStores,
    progress: progress as number,
    workers: workers as number,
    vendorEnabled: vendorEnabled as boolean,
    vendorInstalled: vendorInstalled as boolean,
    connected: connected as boolean,
    serviceTimer: serviceTimer as number,
    upgradeTimer: upgradeTimer as number,
  };
}

function validateHarbour(map: IslandMap, raw: unknown, roads: Set<number>, occupied: Set<number>): Building | null {
  if (!isPlainObject(raw)) return null;
  const { id, kind, rotation, x, z } = raw;
  if (id !== 0 || kind !== 'harbour' || rotation !== 0) return null;
  if (!isInteger(x) || !isInteger(z)) return null;
  const progress = validateHarbourProgress(raw);
  if (!progress) return null;
  const tiles = footprintFor(map, 'harbour', 0, x, z);
  if (!tiles) return null;
  const level = levelOn(map, x, z);
  for (const tile of tiles) {
    const position = tileAtOn(map, tile);
    if (!onHomeIsland(map, position.x, position.z)) return null;
    if (!buildable(terrainOn(map, position.x, position.z))) return null;
    if (levelOn(map, position.x, position.z) !== level) return null;
    if (roads.has(tile) || occupied.has(tile)) return null;
  }
  return harbourAt({ x, z }, progress);
}

function pathIsAdjacent(map: IslandMap, path: number[], roads: Set<number>, overland: Set<number>): boolean {
  for (let i = 0; i < path.length; i++) {
    if (!roads.has(path[i]) && !overland.has(path[i])) return false;
    if (i === 0) continue;
    if (!neighbours(map, path[i - 1]).includes(path[i])) return false;
  }
  return true;
}

function validateWalker(map: IslandMap, raw: unknown, roads: Set<number>, buildingIds: Set<number>): Walker | null {
  if (!isPlainObject(raw)) return null;
  const { id, kind, homeId, targetId, path, step, progress, food, cargo, returning, overland, quarry, working } = raw;
  if (!isNonNegativeFinite(working)) return null;
  const parsedOverland = Array.isArray(overland) && overland.every((tile) => tileInBounds(map, tile)) ? (overland as number[]) : null;
  if (!parsedOverland) return null;
  if (quarry !== null && !isInteger(quarry)) return null;

  if (!isInteger(id) || id <= 0) return null;
  if (typeof kind !== 'string' || !WALKER_KINDS.includes(kind as WalkerKind)) return null;
  if (!isInteger(homeId) || !buildingIds.has(homeId as number)) return null;
  if (targetId !== null && (!isInteger(targetId) || !buildingIds.has(targetId as number))) return null;
  if (!Array.isArray(path) || path.length === 0) return null;
  for (const tile of path) if (!tileInBounds(map, tile)) return null;
  if (!pathIsAdjacent(map, path as number[], roads, new Set(parsedOverland))) return null;
  if (!isInteger(step) || step < 0 || step >= path.length) return null;
  if (!isFiniteNumber(progress) || progress < 0 || progress >= 1) return null;
  if (!isNonNegativeFinite(cargo)) return null;
  if (food !== null && (typeof food !== 'string' || !RESOURCES.includes(food as Resource))) return null;
  if (typeof returning !== 'boolean') return null;

  return {
    id: id as number,
    kind: kind as WalkerKind,
    homeId: homeId as number,
    targetId: targetId as number | null,
    path: path as number[],
    step: step as number,
    progress: progress as number,
    food: food as Resource | null,
    overland: parsedOverland,
    quarry: quarry === null ? null : (quarry as number),
    working: working as number,
    cargo: cargo as number,
    returning: returning as boolean,
  };
}

export function savedBeforeArchipelago(raw: string): boolean {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return false;
    return isInteger(parsed.version) && (parsed.version as number) < ARCHIPELAGO_VERSION;
  } catch {
    return false;
  }
}

export function deserializeWorld(raw: string): World | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  const migrated = migrateSave(parsed);
  if (!migrated) return null;
  const { version, island, seed, home, founded, time, remainder, money, nextId, roads: rawRoads, buildings: rawBuildings, walkers: rawWalkers, wildlife: rawWildlife, felled: rawFelled, regrowth, produced, delivered, harbour: rawHarbour } = migrated;

  if (version !== CURRENT_VERSION) return null;
  if (island !== 'kalliste') return null;
  if (!isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
  if (!isInteger(home) || home < 0 || home >= islandFor(seed).islands.length) return null;
  const map = islandFor(seed, home);
  if (typeof founded !== 'boolean') return null;
  if (!isNonNegativeFinite(time)) return null;
  if (!isNonNegativeFinite(remainder)) return null;
  if (!isFiniteNumber(money)) return null;
  if (!isInteger(nextId) || nextId <= 0) return null;
  if (!isNonNegativeFinite(produced)) return null;
  if (!isNonNegativeFinite(delivered)) return null;
  const roads = validateRoads(map, rawRoads);
  if (!roads) return null;
  const roadSet = new Set(roads);

  if (!Array.isArray(rawBuildings)) return null;
  const occupied = new Set<number>();
  const buildings: Building[] = [];
  const usedIds = new Set<number>();
  for (const entry of rawBuildings) {
    const building = validateBuilding(map, entry, roadSet, occupied);
    if (!building) return null;
    if (usedIds.has(building.id) || building.id >= (nextId as number)) return null;
    usedIds.add(building.id);
    buildings.push(building);
  }

  const harbour = validateHarbour(map, rawHarbour, roadSet, occupied);
  if (!harbour) return null;

  if (!Array.isArray(rawWalkers)) return null;
  const buildingIds = new Set(buildings.map((building) => building.id));
  const walkers: Walker[] = [];
  for (const entry of rawWalkers) {
    const walker = validateWalker(map, entry, roadSet, buildingIds);
    if (!walker) return null;
    if (usedIds.has(walker.id) || walker.id >= (nextId as number)) return null;
    usedIds.add(walker.id);
    walkers.push(walker);
  }

  if (!Array.isArray(rawWildlife)) return null;
  const wildlife: Animal[] = [];
  for (const entry of rawWildlife) {
    const animal = validateAnimal(map, entry);
    if (!animal) return null;
    if (usedIds.has(animal.id) || animal.id >= (nextId as number)) return null;
    usedIds.add(animal.id);
    wildlife.push(animal);
  }

  if (!Array.isArray(rawFelled) || !rawFelled.every((tile) => tileInBounds(map, tile))) return null;
  const felled = rawFelled as number[];
  if (!isNonNegativeFinite(regrowth)) return null;
  if (!founded) {
    const preparedRoads = landingRoads(map);
    if (money !== STARTING_MONEY || roads.length !== preparedRoads.length || preparedRoads.some((tile) => !roadSet.has(tile))) return null;
    if (time !== 0 || remainder !== 0 || produced !== 0 || delivered !== 0 || regrowth !== 0) return null;
    if (buildings.length > 0 || walkers.length > 0 || felled.length > 0) return null;
    if (harbour.tier !== 1 || harbour.progress !== 0 || harbour.vendorInstalled || Object.keys(harbour.stores).length > 0) return null;
  }

  const world: World = {
    version: CURRENT_VERSION,
    island: 'kalliste',
    seed: seed as number,
    home,
    founded,
    time: time as number,
    remainder: remainder as number,
    money: money as number,
    nextId: nextId as number,
    roads,
    buildings,
    walkers,
    wildlife,
    felled,
    regrowth: regrowth as number,
    produced: produced as number,
    delivered: delivered as number,
    harbour,
  };
  recomputeConnectivity(world);
  dropInvalidWalkers(world);
  return world;
}

export function parseStores(raw: unknown): Stores | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const stores: Stores = {};
  for (const [food, amount] of Object.entries(raw)) {
    if (!RESOURCES.includes(food as Resource) || !isNonNegativeFinite(amount)) return null;
    if ((amount as number) > 0) stores[food as Resource] = amount as number;
  }
  return stores;
}

function validateAnimal(map: IslandMap, raw: unknown): Animal | null {
  if (!isPlainObject(raw)) return null;
  const { id, kind, x, z, homeX, homeZ, heading, phase, respawn, cornered } = raw;
  if (!isInteger(id) || id <= 0) return null;
  if (typeof kind !== 'string' || !ANIMAL_KINDS.includes(kind as AnimalKind)) return null;
  for (const value of [x, homeX]) if (!isFiniteNumber(value) || value < 0 || value > map.width) return null;
  for (const value of [z, homeZ]) if (!isFiniteNumber(value) || value < 0 || value > map.depth) return null;
  if (!isFiniteNumber(heading) || !isFiniteNumber(phase) || !isNonNegativeFinite(respawn) || typeof cornered !== 'boolean') return null;
  return { id, kind: kind as AnimalKind, x: x as number, z: z as number, homeX: homeX as number, homeZ: homeZ as number, heading: heading as number, phase: phase as number, respawn: respawn as number, cornered };
}
