import { advance } from './world';
import { primaryCity } from './city';
import type { World } from './types';

export const UNDO_SECONDS = 15;

export function canUndoConstruction(world: World, checkpoint: World | null): checkpoint is World {
  if (!checkpoint) return false;
  if (world.cities.length !== 1 || checkpoint.cities.length !== 1) return false;
  const city = primaryCity(world);
  const checkpointCity = primaryCity(checkpoint);
  if (checkpoint.seed !== world.seed || checkpointCity.id !== city.id || checkpointCity.home !== city.home || checkpointCity.founded !== city.founded || checkpoint.version !== world.version) return false;
  const elapsed = world.time - checkpoint.time;
  return elapsed >= 0 && elapsed <= UNDO_SECONDS;
}

export function undoConstruction(world: World, checkpoint: World | null): World | null {
  if (!canUndoConstruction(world, checkpoint)) return null;
  const restored = structuredClone(checkpoint);
  advance(restored, world.time - checkpoint.time + world.remainder - checkpoint.remainder);
  return restored;
}
