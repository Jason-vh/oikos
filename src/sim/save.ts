import { CURRENT_VERSION, WORLD_LABEL, type Animal, type Building, type BuildingKind, type City, type Resource, type Rotation, type StallGood, type Stalls, type Stores, type Walker, type WalkerKind, type WalkerTask, type World } from './types';
import { STALL_GOODS, stallsInstalled } from './stalls';


import { BUILDINGS, HOUSE_CAPACITY, RESOURCES } from './catalog';
import { WALKER_SPEED } from './balance';
import { wildlifeRoster } from './wildlife';
import { islandFor, insideMapOn, ISLAND_COUNT, type IslandMap } from './island';
import { harbourIslandAt } from './founding';
import { cityName } from './claims';
import { cityColor, cityColorAt } from './colors';
import { footprintTiles, neighbours } from './grid';
import { dropInvalidWalkers, recomputeConnectivity } from './world';
import { harbourAt, validateHarbourProgress } from './harbour';
export { CURRENT_VERSION };

export interface AnimalFate {
  id: number;
  respawnAt: number | null;
  cornered: boolean;
}

function fated(animal: Animal): boolean {
  return animal.respawnAt !== null || animal.cornered;
}

function countdownsScheduled(parsed: Record<string, unknown>): Record<string, unknown> {
  const time = isNonNegativeFinite(parsed.time) ? parsed.time : 0;
  const cities = Array.isArray(parsed.cities) ? parsed.cities : [];
  return {
    ...parsed,
    version: 14,
    cities: cities.map((city) => {
      if (!isPlainObject(city) || !Array.isArray(city.walkers)) return city;
      return {
        ...city,
        walkers: city.walkers.map((entry) => {
          if (!isPlainObject(entry)) return entry;
          const { working, ...rest } = entry;
          const left = isFiniteNumber(working) ? working : 0;
          const kind = rest.kind === 'hunter' ? 'hunt' : 'chop';
          return { ...rest, task: left > 0 ? { kind, since: time, until: time + left } : null };
        }),
      };
    }),
  };
}

function rosterForgotten(parsed: Record<string, unknown>): Record<string, unknown> {
  const wildlife = Array.isArray(parsed.wildlife) ? parsed.wildlife : [];
  const kept = wildlife.filter((entry) => isPlainObject(entry) && (entry.respawnAt !== null || entry.cornered === true));
  return { ...parsed, version: 13, wildlife: kept };
}

function archipelagoRelabelled(parsed: Record<string, unknown>): Record<string, unknown> {
  if (parsed.island !== 'kalliste') return parsed;
  return { ...parsed, version: 16, island: WORLD_LABEL };
}

function citiesColoured(parsed: Record<string, unknown>): Record<string, unknown> {
  const cities = Array.isArray(parsed.cities) ? parsed.cities : [];
  return {
    ...parsed,
    version: 17,
    cities: cities.map((city, index) => (isPlainObject(city) ? { ...city, color: cityColor(city.color) ?? cityColorAt(index) } : city)),
  };
}

function vendorsBecameStalls(parsed: Record<string, unknown>): Record<string, unknown> {
  const cities = Array.isArray(parsed.cities) ? parsed.cities : [];
  return {
    ...parsed,
    version: 18,
    cities: cities.map((city) => {
      if (!isPlainObject(city) || !Array.isArray(city.buildings)) return city;
      return {
        ...city,
        buildings: city.buildings.map((entry) => {
          if (!isPlainObject(entry)) return entry;
          const raised = { oil: 0, stalls: {} as Record<string, unknown>, ...entry };
          if (entry.kind !== 'agora' || entry.vendorInstalled !== true) return raised;
          return {
            ...raised,
            vendorInstalled: false,
            vendorEnabled: false,
            stalls: { food: { installed: true, enabled: entry.vendorEnabled === true } },
          };
        }),
      };
    }),
  };
}

const MIGRATIONS: Array<[number, (parsed: Record<string, unknown>) => Record<string, unknown>]> = [
  [12, rosterForgotten],
  [13, countdownsScheduled],
  [15, archipelagoRelabelled],
  [16, citiesColoured],
  [17, vendorsBecameStalls],
];

function raise(parsed: Record<string, unknown>): Record<string, unknown> {
  let raised = parsed;
  for (const [from, migrate] of MIGRATIONS) {
    if (raised.version === from) raised = migrate(raised);
  }
  return raised;
}

export function savedVersion(raw: string): number | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed) || !isInteger(parsed.version)) return null;
    return parsed.version;
  } catch {
    return null;
  }
}

export function wildlifeFates(world: World): AnimalFate[] {
  return world.wildlife
    .filter(fated)
    .map((animal) => ({ id: animal.id, respawnAt: animal.respawnAt, cornered: animal.cornered }));
}

export function serializeWorld(world: World): string {
  return JSON.stringify({ ...world, wildlife: wildlifeFates(world) });
}

const BUILDING_KINDS: BuildingKind[] = ['house', 'farm', 'orchard', 'press', 'granary', 'agora', 'fountain', 'maintenance', 'lodge', 'woodcutter', 'stockpile', 'wharf', 'harbour'];
const WALKER_KINDS: WalkerKind[] = ['cart', 'buyer', 'vendor', 'water', 'maintenance', 'immigrant', 'hunter', 'woodcutter', 'fisher', 'porter'];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
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
  const { id, x, z, kind, rotation, tier, residents, food, water, oil, condition, stores, progress, workers, vendorEnabled, vendorInstalled, stalls, connected, serviceTimer, upgradeTimer } = raw;

  if (!isSafeInteger(id) || id <= 0) return null;
  if (!isInteger(x) || !isInteger(z)) return null;
  if (typeof kind !== 'string' || !BUILDING_KINDS.includes(kind as BuildingKind)) return null;
  if (![0, 1, 2, 3].includes(rotation as number)) return null;
  if (![1, 2, 3, 4].includes(tier as number)) return null;
  if (!isNonNegativeFinite(residents)) return null;
  if (!isNonNegativeFinite(food)) return null;
  if (!isNonNegativeFinite(water)) return null;
  if (!isNonNegativeFinite(oil)) return null;
  if (!isFiniteNumber(condition) || condition < 0 || condition > 100) return null;
  const parsedStores = parseStores(stores);
  if (!parsedStores) return null;
  if (!isFiniteNumber(progress) || progress < 0 || progress >= 1) return null;
  if (!isNonNegativeFinite(workers)) return null;
  if (typeof vendorEnabled !== 'boolean') return null;
  if (typeof vendorInstalled !== 'boolean') return null;
  if (vendorEnabled && !vendorInstalled) return null;
  const parsedStalls = parseStalls(stalls);
  if (!parsedStalls) return null;
  if (kind !== 'agora' && stallsInstalled(parsedStalls) > 0) return null;
  if (typeof connected !== 'boolean') return null;
  if (!isNonNegativeFinite(serviceTimer)) return null;
  if (!isNonNegativeFinite(upgradeTimer)) return null;

  const builtKind = kind as BuildingKind;
  const builtTier = tier as Building['tier'];
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
    oil: oil as number,
    condition: condition as number,
    stores: parsedStores,
    progress: progress as number,
    workers: workers as number,
    vendorEnabled: vendorEnabled as boolean,
    vendorInstalled: vendorInstalled as boolean,
    stalls: parsedStalls,
    connected: connected as boolean,
    serviceTimer: serviceTimer as number,
    upgradeTimer: upgradeTimer as number,
  };
}

function validateHarbour(map: IslandMap, home: number, raw: unknown, roads: Set<number>, occupied: Set<number>): Building | null {
  if (!isPlainObject(raw)) return null;
  const { id, kind, rotation, x, z } = raw;
  if (!isSafeInteger(id) || id < 0 || kind !== 'harbour') return null;
  if (!isInteger(rotation) || (rotation as number) < 0 || (rotation as number) > 3) return null;
  if (!isInteger(x) || !isInteger(z)) return null;
  const progress = validateHarbourProgress(raw);
  if (!progress) return null;
  const site = { x: x as number, z: z as number, rotation: rotation as Rotation };
  if (harbourIslandAt(map, site.x, site.z, site.rotation) !== map.islands[home]) return null;
  const tiles = footprintFor(map, 'harbour', site.rotation, site.x, site.z);
  if (!tiles) return null;
  for (const tile of tiles) {
    if (roads.has(tile) || occupied.has(tile)) return null;
  }
  return { ...harbourAt(site, progress), id: id as number };
}

function pathIsAdjacent(map: IslandMap, path: number[], roads: Set<number>, overland: Set<number>): boolean {
  for (let i = 0; i < path.length; i++) {
    if (!roads.has(path[i]) && !overland.has(path[i])) return false;
    if (i === 0) continue;
    if (!neighbours(map, path[i - 1]).includes(path[i])) return false;
  }
  return true;
}

function validateWalker(map: IslandMap, time: number, raw: unknown, roads: Set<number>, buildingIds: Set<number>): Walker | null {
  if (!isPlainObject(raw)) return null;
  const { id, kind, homeId, targetId, path, departedAt, step, progress, food, cargo, returning, overland, quarry, task: rawTask } = raw;
  const task = validateTask(rawTask);
  if (task === undefined) return null;
  const parsedOverland = Array.isArray(overland) && overland.every((tile) => tileInBounds(map, tile)) ? (overland as number[]) : null;
  if (!parsedOverland) return null;
  if (quarry !== null && !isInteger(quarry)) return null;

  if (!isSafeInteger(id) || id <= 0) return null;
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
    departedAt: isFiniteNumber(departedAt) ? departedAt : time - ((step as number) + (progress as number)) / WALKER_SPEED,
    step: step as number,
    progress: progress as number,
    food: food as Resource | null,
    overland: parsedOverland,
    quarry: quarry === null ? null : (quarry as number),
    task,
    cargo: cargo as number,
    returning: returning as boolean,
  };
}

export function deserializeWorld(raw: string): World | null {
  return parseWorld(raw, (count) => count === 1);
}

export function deserializeSharedWorld(raw: string): World | null {
  return parseWorld(raw, (count) => count >= 0 && count <= ISLAND_COUNT);
}

function parseWorld(raw: string, cityCountAllowed: (count: number) => boolean): World | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  const raised = raise(parsed);
  const { version, island, seed, time, remainder, nextId, nextCityId, wildlife: rawWildlife, felled: rawFelled, regrowth, cities: rawCities } = raised;

  if (version !== CURRENT_VERSION) return null;
  if (island !== WORLD_LABEL) return null;
  if (!isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
  if (!isNonNegativeFinite(time)) return null;
  if (!isNonNegativeFinite(remainder)) return null;
  if (!isSafeInteger(nextId) || nextId <= 0) return null;
  if (!isSafeInteger(nextCityId) || nextCityId <= 0) return null;
  if (!Array.isArray(rawCities) || !cityCountAllowed(rawCities.length)) return null;

  const atlas = islandFor(seed);
  if (!Array.isArray(rawFelled) || !rawFelled.every((tile) => tileInBounds(atlas, tile))) return null;
  const felled = rawFelled as number[];
  if (!isNonNegativeFinite(regrowth)) return null;

  const usedEntityIds = new Set<number>();
  const usedCityIds = new Set<number>();
  const usedHomes = new Set<number>();
  const occupiedTiles = new Set<number>();
  let zeroHarbourSeen = false;
  const cities: City[] = [];

  for (const rawCity of rawCities) {
    if (!isPlainObject(rawCity)) return null;
    const { id, name, color: rawColor, home, money, harbour: rawHarbour, produced, delivered, roads: rawRoads, buildings: rawBuildings, walkers: rawWalkers } = rawCity;
    if (!isSafeInteger(id) || id <= 0) return null;
    if (usedCityIds.has(id) || id >= (nextCityId as number)) return null;
    usedCityIds.add(id);
    if (!isInteger(home) || home < 0 || home >= ISLAND_COUNT) return null;
    if (usedHomes.has(home)) return null;
    usedHomes.add(home);
    const map = islandFor(seed as number, home as number);
    if (typeof name !== 'string' || cityName(name) !== name) return null;
    const color = cityColor(rawColor);
    if (!color) return null;
    if (!isFiniteNumber(money)) return null;
    if (!isNonNegativeFinite(produced)) return null;
    if (!isNonNegativeFinite(delivered)) return null;

    const roads = validateRoads(map, rawRoads);
    if (!roads) return null;
    const roadSet = new Set(roads);
    for (const tile of roads) {
      if (occupiedTiles.has(tile)) return null;
      occupiedTiles.add(tile);
    }

    if (!Array.isArray(rawBuildings)) return null;
    const localOccupied = new Set<number>();
    const buildings: Building[] = [];
    for (const entry of rawBuildings) {
      const building = validateBuilding(map, entry, roadSet, localOccupied);
      if (!building) return null;
      if (usedEntityIds.has(building.id) || building.id >= (nextId as number)) return null;
      usedEntityIds.add(building.id);
      buildings.push(building);
    }
    for (const tile of localOccupied) {
      if (occupiedTiles.has(tile)) return null;
      occupiedTiles.add(tile);
    }

    const harbour = validateHarbour(map, home as number, rawHarbour, roadSet, localOccupied);
    if (!harbour) return null;
    if (usedEntityIds.has(harbour.id)) return null;
    if (harbour.id === 0) {
      if (zeroHarbourSeen) return null;
      zeroHarbourSeen = true;
    } else if (harbour.id >= (nextId as number)) return null;
    usedEntityIds.add(harbour.id);
    for (const tile of footprintTiles(map, harbour)) {
      if (occupiedTiles.has(tile)) return null;
      occupiedTiles.add(tile);
    }

    if (!Array.isArray(rawWalkers)) return null;
    const buildingIds = new Set(buildings.map((building) => building.id));
    const walkers: Walker[] = [];
    for (const entry of rawWalkers) {
      const walker = validateWalker(map, time as number, entry, roadSet, buildingIds);
      if (!walker) return null;
      if (usedEntityIds.has(walker.id) || walker.id >= (nextId as number)) return null;
      usedEntityIds.add(walker.id);
      walkers.push(walker);
    }

    const city: City = { id: id as number, name, color, home: home as number, money: money as number, harbour, produced: produced as number, delivered: delivered as number, roads, buildings, walkers };
    cities.push(city);
  }

  const wildlife = rosterWithFates(seed as number, nextId as number, usedEntityIds, rawWildlife);
  if (!wildlife) return null;

  const world: World = {
    version: CURRENT_VERSION,
    island: WORLD_LABEL,
    seed: seed as number,
    time: time as number,
    remainder: remainder as number,
    nextId: nextId as number,
    nextCityId: nextCityId as number,
    wildlife,
    felled,
    regrowth: regrowth as number,
    cities,
  };
  for (const city of cities) {
    recomputeConnectivity(world, city);
    dropInvalidWalkers(world, city);
  }
  return world;
}

function rosterWithFates(seed: number, nextId: number, used: Set<number>, raw: unknown): Animal[] | null {
  if (!Array.isArray(raw)) return null;
  const wildlife = wildlifeRoster(seed);
  if (wildlife.length >= nextId) return null;
  const byId = new Map<number, Animal>();
  for (const animal of wildlife) {
    if (used.has(animal.id)) return null;
    used.add(animal.id);
    byId.set(animal.id, animal);
  }
  for (const entry of raw) {
    const fate = validateFate(entry);
    if (!fate) return null;
    const animal = byId.get(fate.id);
    if (!animal) return null;
    animal.respawnAt = fate.respawnAt;
    animal.cornered = fate.cornered;
  }
  return wildlife;
}

export function deserializeWildlife(world: World, raw: unknown): Animal[] | null {
  const used = new Set<number>();
  for (const city of world.cities) {
    used.add(city.harbour.id);
    for (const building of city.buildings) used.add(building.id);
    for (const walker of city.walkers) used.add(walker.id);
  }
  return rosterWithFates(world.seed, world.nextId, used, raw);
}

export function parseStalls(raw: unknown): Stalls | null {
  if (raw === undefined) return {};
  if (!isPlainObject(raw)) return null;
  const stalls: Stalls = {};
  for (const [good, state] of Object.entries(raw)) {
    if (!STALL_GOODS.includes(good as StallGood) || !isPlainObject(state)) return null;
    const { installed, enabled } = state;
    if (typeof installed !== 'boolean' || typeof enabled !== 'boolean') return null;
    if (enabled && !installed) return null;
    stalls[good as StallGood] = { installed, enabled };
  }
  return stalls;
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

function validateTask(raw: unknown): WalkerTask | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (!isPlainObject(raw)) return undefined;
  const { kind, since, until } = raw;
  if (kind !== 'chop' && kind !== 'hunt' && kind !== 'net') return undefined;
  if (!isNonNegativeFinite(since) || !isNonNegativeFinite(until) || (until as number) < (since as number)) return undefined;
  return { kind, since: since as number, until: until as number };
}

function validateFate(raw: unknown): AnimalFate | null {
  if (!isPlainObject(raw)) return null;
  const { id, respawnAt, cornered } = raw;
  if (!isSafeInteger(id) || id <= 0) return null;
  if (respawnAt !== null && !isNonNegativeFinite(respawnAt)) return null;
  if (typeof cornered !== 'boolean') return null;
  if (respawnAt === null && cornered === false) return null;
  return { id, respawnAt: respawnAt === null ? null : (respawnAt as number), cornered };
}
