import { deserializeWorld, serializeWorld } from '../sim/save';
import type { World } from '../sim/types';

export const AUTOSAVE_KEY = 'oikos.island.v1';
export const CHECKPOINT_KEY = 'oikos.checkpoint.v1';

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readCheckpoint(storage: SaveStorage): World | null {
  const raw = storage.getItem(CHECKPOINT_KEY);
  return raw === null ? null : deserializeWorld(raw);
}

export function writeAutosave(storage: SaveStorage, world: World): void {
  storage.setItem(AUTOSAVE_KEY, serializeWorld(world));
}

export function writeCheckpoint(storage: SaveStorage, world: World): void {
  storage.setItem(CHECKPOINT_KEY, serializeWorld(world));
}

export function islandFilename(world: World): string {
  return `oikos-${world.seed}-${Math.floor(world.time)}.json`;
}
