import type { ActionResult, Building, Stores, Tile, World } from './types';
import { footprint } from './catalog';
import { primaryCity } from './city';
import { buildable, insideMapOn, islandFor, levelOn, terrainOn, tileIndexOn, type IslandMap } from './island';
import { exitTile, findNearestConnected, footprintTiles } from './grid';
import { addStore, spawnWalker, totalStock } from './world';
import { parseStores } from './save';

export const HARBOUR_ID = 0;
export const HARBOUR_UPGRADE_LUMBER = 200;
export const HARBOUR_DOCK_CAP = 200;
export const PORTER_CAPACITY = 60;
export const HARBOUR_MIN_CARGO = 100;
export const HARBOUR_VOYAGE_SECONDS = 16;
export const HARBOUR_LUMBER_PRICE = 1.4;

export interface HarbourProgress { tier: 1 | 2; stores: Stores; vendorEnabled: boolean; vendorInstalled: boolean; progress: number; }

function freshProgress(): HarbourProgress {
  return { tier: 1, stores: {}, vendorEnabled: false, vendorInstalled: false, progress: 0 };
}

function siteClear(map: IslandMap, x: number, z: number, width: number, depth: number, roads: Set<number>): boolean {
  const level = levelOn(map, x, z);
  for (let dz = 0; dz < depth; dz++) {
    for (let dx = 0; dx < width; dx++) {
      const tx = x + dx;
      const tz = z + dz;
      if (!insideMapOn(map, tx, tz)) return false;
      if (levelOn(map, tx, tz) !== level) return false;
      if (!buildable(terrainOn(map, tx, tz))) return false;
      if (roads.has(tileIndexOn(map, tx, tz))) return false;
    }
  }
  return true;
}

function siteTouchesRoad(map: IslandMap, roads: Set<number>, x: number, z: number, width: number, depth: number): boolean {
  for (let dz = -1; dz <= depth; dz++) {
    for (let dx = -1; dx <= width; dx++) {
      const onRing = dx === -1 || dx === width || dz === -1 || dz === depth;
      if (!onRing) continue;
      const tx = x + dx;
      const tz = z + dz;
      if (!insideMapOn(map, tx, tz)) continue;
      if (roads.has(tileIndexOn(map, tx, tz))) return true;
    }
  }
  return false;
}

function northOfEntry(entry: { x: number; z: number }, z: number, depth: number): boolean {
  return z + depth <= entry.z;
}

function findHarbourSite(map: IslandMap, roads: Set<number>, width: number, depth: number): { x: number; z: number } {
  const entry = map.entry;
  for (let radius = 1; radius <= 24; radius++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const x = entry.x + dx;
        const z = entry.z + dz;
        if (!northOfEntry(entry, z, depth)) continue;
        if (!siteClear(map, x, z, width, depth, roads)) continue;
        if (!siteTouchesRoad(map, roads, x, z, width, depth)) continue;
        return { x, z };
      }
    }
  }
  return { x: entry.x, z: entry.z - depth };
}

export function siteHarbour(seed: number, roads: number[], progress: HarbourProgress, home?: number): Building {
  const map = islandFor(seed, home);
  const { width, depth } = footprint('harbour', 0);
  const site = findHarbourSite(map, new Set(roads), width, depth);
  return harbourAt(site, progress);
}

export function harbourAt(site: Tile, progress: HarbourProgress): Building {
  return {
    id: HARBOUR_ID,
    x: site.x,
    z: site.z,
    kind: 'harbour',
    rotation: 0,
    tier: progress.tier,
    residents: 0,
    food: 0,
    water: 0,
    condition: 100,
    stores: progress.stores,
    progress: progress.progress,
    workers: 0,
    vendorEnabled: progress.vendorEnabled,
    vendorInstalled: progress.vendorInstalled,
    connected: false,
    serviceTimer: 0,
    upgradeTimer: 0,
  };
}

export function freshHarbour(seed: number, roads: number[], home?: number): Building {
  return siteHarbour(seed, roads, freshProgress(), home);
}

export function harbourTiles(world: World): number[] {
  const city = primaryCity(world);
  if (!city.founded) return [];
  return footprintTiles(islandFor(world.seed), city.harbour);
}

export function validateHarbourProgress(raw: unknown): HarbourProgress | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { tier, stores, vendorEnabled, vendorInstalled, progress } = raw as Record<string, unknown>;
  if (tier !== 1 && tier !== 2) return null;
  if (typeof vendorEnabled !== 'boolean' || typeof vendorInstalled !== 'boolean') return null;
  if (vendorEnabled && !vendorInstalled) return null;
  if (typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress >= 1) return null;
  const parsedStores = parseStores(stores);
  if (!parsedStores) return null;
  return { tier, stores: parsedStores, vendorEnabled, vendorInstalled, progress };
}

function dispatchPorter(world: World): void {
  const city = primaryCity(world);
  const harbour = city.harbour;
  if (city.walkers.some((walker) => walker.kind === 'porter')) return;
  const room = HARBOUR_DOCK_CAP - totalStock(harbour);
  if (room <= 0) return;
  const exit = exitTile(world, city, harbour);
  if (exit === -1) return;
  const stockpiles = city.buildings.filter((building) => building.kind === 'stockpile' && building.connected && (building.stores.lumber ?? 0) > 0);
  const found = findNearestConnected(world, city, exit, stockpiles);
  if (!found) return;
  const cargo = Math.min(found.building.stores.lumber ?? 0, PORTER_CAPACITY, room);
  if (cargo <= 0) return;
  addStore(found.building, 'lumber', -cargo);
  spawnWalker(world, {
    kind: 'porter',
    homeId: found.building.id,
    targetId: null,
    path: [...found.path].reverse(),
    step: 0,
    progress: 0,
    food: 'lumber',
    cargo,
    returning: false,
  });
}

export function updateHarbour(world: World, dt: number): void {
  const harbour = primaryCity(world).harbour;
  if (!harbour.connected) return;
  if (harbour.progress > 0) {
    const next = harbour.progress + dt / HARBOUR_VOYAGE_SECONDS;
    harbour.progress = next >= 1 ? 0 : next;
    return;
  }
  const stock = totalStock(harbour);
  if (harbour.tier === 1) {
    if (stock >= HARBOUR_UPGRADE_LUMBER) {
      addStore(harbour, 'lumber', -HARBOUR_UPGRADE_LUMBER);
      harbour.tier = 2;
    } else {
      dispatchPorter(world);
    }
    return;
  }
  if (!harbour.vendorEnabled) return;
  if (stock >= HARBOUR_MIN_CARGO) {
    primaryCity(world).money += stock * HARBOUR_LUMBER_PRICE;
    addStore(harbour, 'lumber', -stock);
    harbour.progress = Math.min(.999, dt / HARBOUR_VOYAGE_SECONDS);
  } else {
    dispatchPorter(world);
  }
}

export function harbourStatus(harbour: Building): string[] {
  if (harbour.tier === 1) {
    const percent = Math.round((totalStock(harbour) / HARBOUR_UPGRADE_LUMBER) * 100);
    return [`Rebuilding the quay in stone with lumber from the stockpiles, ${percent}% delivered.`];
  }
  if (harbour.progress > 0) return ['A ship is at sea with a hold of lumber.'];
  if (!harbour.vendorEnabled) return ['The harbour is rebuilt. Start the lumber trade to earn from exports.'];
  const stock = totalStock(harbour);
  if (stock >= HARBOUR_MIN_CARGO) return ['Loading the ship for departure.'];
  return [`Waiting for lumber, ${Math.round(stock)} / ${HARBOUR_MIN_CARGO} aboard.`];
}

export function setHarbourTrade(harbour: Building, enabled: boolean): ActionResult {
  if (!enabled) {
    harbour.vendorEnabled = false;
    return { ok: true, reason: 'Lumber trade paused.' };
  }
  if (harbour.tier < 2) return { ok: false, reason: 'The harbour needs rebuilding first.' };
  if (harbour.vendorEnabled) return { ok: true, reason: 'Lumber trade already active.' };
  const resumed = harbour.vendorInstalled;
  harbour.vendorInstalled = true;
  harbour.vendorEnabled = true;
  return { ok: true, reason: resumed ? 'Lumber trade resumed.' : 'Lumber trade started.' };
}
