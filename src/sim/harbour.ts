import type { ActionResult, Building, City, Rotation, Stores, World } from './types';
import { islandFor } from './island';
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

export interface HarbourPlot { x: number; z: number; rotation: Rotation }

export function harbourAt(site: HarbourPlot, progress: HarbourProgress): Building {
  return {
    id: HARBOUR_ID,
    x: site.x,
    z: site.z,
    kind: 'harbour',
    rotation: site.rotation,
    tier: progress.tier,
    residents: 0,
    food: 0,
    water: 0,
    oil: 0,
    condition: 100,
    stores: progress.stores,
    progress: progress.progress,
    workers: 0,
    vendorEnabled: progress.vendorEnabled,
    vendorInstalled: progress.vendorInstalled,
    stalls: {},
    connected: false,
    serviceTimer: 0,
    upgradeTimer: 0,
  };
}

export function freshHarbour(site: HarbourPlot): Building {
  return harbourAt(site, freshProgress());
}

export function harbourTiles(world: World, city: City): number[] {
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

function dispatchPorter(world: World, city: City): void {
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
  spawnWalker(world, city, {
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

export function updateHarbour(world: World, city: City, dt: number): void {
  const harbour = city.harbour;
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
      dispatchPorter(world, city);
    }
    return;
  }
  if (!harbour.vendorEnabled) return;
  if (stock >= HARBOUR_MIN_CARGO) {
    city.money += stock * HARBOUR_LUMBER_PRICE;
    addStore(harbour, 'lumber', -stock);
    harbour.progress = Math.min(.999, dt / HARBOUR_VOYAGE_SECONDS);
  } else {
    dispatchPorter(world, city);
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
