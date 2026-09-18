import { BUILDINGS } from './catalog';
import type { ActionResult, BuildTool, Rotation, StallGood, Tile, World } from './types';
import { STALL_GOODS } from './stalls';
import { build, demolish, placeRoadPath, setVendor } from './world';
import { plant } from './crops';

export type CityCommand =
  | { type: 'build'; tool: BuildTool; x: number; z: number; rotation: Rotation }
  | { type: 'roadPath'; tiles: Tile[] }
  | { type: 'demolish'; x: number; z: number }
  | { type: 'vendor'; id: number; enabled: boolean; stall: StallGood }
  | { type: 'plant'; id: number; tiles: Tile[] };

export const MAX_ROAD_PATH = 1024;
export const MAX_PLANTING = 256;

export const BUILD_TOOLS = new Set<string>(['road', ...Object.keys(BUILDINGS).filter((kind) => kind !== 'harbour')]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function tile(value: unknown): value is Tile {
  return record(value) && integer(value.x) && integer(value.z);
}

export function parseCommand(raw: unknown): CityCommand | null {
  if (!record(raw)) return null;
  if (raw.type === 'build') {
    if (!tile(raw) || typeof raw.tool !== 'string' || !BUILD_TOOLS.has(raw.tool)) return null;
    if (!integer(raw.rotation) || raw.rotation < 0 || raw.rotation > 3) return null;
    return { type: 'build', tool: raw.tool as BuildTool, x: raw.x, z: raw.z, rotation: raw.rotation as Rotation };
  }
  if (raw.type === 'roadPath') {
    if (!Array.isArray(raw.tiles) || raw.tiles.length === 0 || raw.tiles.length > MAX_ROAD_PATH) return null;
    const tiles: Tile[] = [];
    for (const entry of raw.tiles) {
      if (!tile(entry)) return null;
      tiles.push({ x: entry.x, z: entry.z });
    }
    return { type: 'roadPath', tiles };
  }
  if (raw.type === 'demolish') {
    if (!tile(raw)) return null;
    return { type: 'demolish', x: raw.x, z: raw.z };
  }
  if (raw.type === 'plant') {
    if (!integer(raw.id) || raw.id <= 0) return null;
    if (!Array.isArray(raw.tiles) || raw.tiles.length === 0 || raw.tiles.length > MAX_PLANTING) return null;
    const tiles: Tile[] = [];
    for (const entry of raw.tiles) {
      if (!tile(entry)) return null;
      tiles.push({ x: entry.x, z: entry.z });
    }
    return { type: 'plant', id: raw.id, tiles };
  }
  if (raw.type === 'vendor') {
    if (!integer(raw.id) || raw.id < 0 || typeof raw.enabled !== 'boolean') return null;
    const stall = raw.stall ?? 'food';
    if (typeof stall !== 'string' || !STALL_GOODS.includes(stall as StallGood)) return null;
    return { type: 'vendor', id: raw.id, enabled: raw.enabled, stall: stall as StallGood };
  }
  return null;
}

export function applyCommand(world: World, cityId: number, raw: unknown): ActionResult {
  const command = parseCommand(raw);
  if (!command) return { ok: false, reason: 'Invalid city command.' };
  const city = world.cities.find((candidate) => candidate.id === cityId);
  if (!city) return { ok: false, reason: 'No such city.' };
  switch (command.type) {
    case 'build': return build(world, city, command.tool, command.x, command.z, command.rotation);
    case 'roadPath': return placeRoadPath(world, city, command.tiles);
    case 'demolish': return demolish(world, city, command.x, command.z);
    case 'vendor': return setVendor(city, command.id, command.enabled, command.stall);
    case 'plant': return plant(world, city, command.id, command.tiles);
  }
}
