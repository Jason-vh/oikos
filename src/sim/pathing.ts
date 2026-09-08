import type { Grid } from './grid';
import type { Building } from './types';

export function roadAccessTiles(grid: Grid, building: Building): number[] {
  const tiles: number[] = [];
  for (const tile of grid.perimeter(building.x, building.y, building.size)) {
    if (grid.isRoad(tile)) tiles.push(tile);
  }
  return tiles;
}

export function hasRoadAccess(grid: Grid, building: Building): boolean {
  for (const tile of grid.perimeter(building.x, building.y, building.size)) {
    if (grid.isRoad(tile)) return true;
  }
  return false;
}

export function bfsRoute(
  grid: Grid,
  start: number,
  isGoal: (tile: number) => boolean,
  maxTiles = 4096,
): number[] | null {
  if (isGoal(start)) return [start];

  const cameFrom = new Map<number, number>();
  const queue: number[] = [start];
  cameFrom.set(start, -1);
  let head = 0;

  while (head < queue.length && cameFrom.size < maxTiles) {
    const current = queue[head++];
    for (const next of grid.neighbours(current)) {
      if (cameFrom.has(next) || !grid.isRoad(next)) continue;
      cameFrom.set(next, current);
      if (isGoal(next)) return reconstruct(cameFrom, next);
      queue.push(next);
    }
  }
  return null;
}

function reconstruct(cameFrom: Map<number, number>, goal: number): number[] {
  const path: number[] = [];
  let node = goal;
  while (node !== -1) {
    path.push(node);
    node = cameFrom.get(node) ?? -1;
  }
  return path.reverse();
}

export function nextRoamTile(grid: Grid, current: number, previous: number): number {
  const options = grid.neighbours(current).filter((tile) => grid.isRoad(tile));
  if (options.length === 0) return -1;
  const forward = options.filter((tile) => tile !== previous);
  const pool = forward.length > 0 ? forward : options;
  return pool[Math.floor(Math.random() * pool.length)];
}
