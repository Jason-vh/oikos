import { BUILDINGS } from './catalog';
import { foundHarbour } from './founding';
import type { ActionResult, BuildTool, Rotation, Tile, World } from './types';
import { build, demolish, placeRoadPath, setVendor } from './world';

export type CityCommand =
  | { type: 'build'; tool: BuildTool; x: number; z: number; rotation: Rotation }
  | { type: 'roadPath'; tiles: Tile[] }
  | { type: 'demolish'; x: number; z: number }
  | { type: 'vendor'; id: number; enabled: boolean }
  | { type: 'foundHarbour'; x: number; z: number };

export const MAX_ROAD_PATH = 1024;

const BUILD_TOOLS = new Set<string>(['road', ...Object.keys(BUILDINGS).filter((kind) => kind !== 'harbour')]);

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
  if (raw.type === 'demolish' || raw.type === 'foundHarbour') {
    if (!tile(raw)) return null;
    return { type: raw.type, x: raw.x, z: raw.z };
  }
  if (raw.type === 'vendor') {
    if (!integer(raw.id) || raw.id < 0 || typeof raw.enabled !== 'boolean') return null;
    return { type: 'vendor', id: raw.id, enabled: raw.enabled };
  }
  return null;
}

export function applyCommand(world: World, raw: unknown): ActionResult {
  const command = parseCommand(raw);
  if (!command) return { ok: false, reason: 'Invalid city command.' };
  switch (command.type) {
    case 'build': return build(world, command.tool, command.x, command.z, command.rotation);
    case 'roadPath': return placeRoadPath(world, command.tiles);
    case 'demolish': return demolish(world, command.x, command.z);
    case 'vendor': return setVendor(world, command.id, command.enabled);
    case 'foundHarbour': return foundHarbour(world, command.x, command.z);
  }
}
