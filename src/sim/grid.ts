import type { Building, World } from './types';
import { footprint } from './catalog';
import { ENTRY, insideMap, tileAt, tileIndex } from './island';

export function neighbours(tile: number): number[] {
  const { x, z } = tileAt(tile);
  const result: number[] = [];
  if (insideMap(x, z - 1)) result.push(tileIndex(x, z - 1));
  if (insideMap(x + 1, z)) result.push(tileIndex(x + 1, z));
  if (insideMap(x, z + 1)) result.push(tileIndex(x, z + 1));
  if (insideMap(x - 1, z)) result.push(tileIndex(x - 1, z));
  return result;
}

export function footprintTiles(building: Building): number[] {
  const { width, depth } = footprint(building.kind, building.rotation);
  const tiles: number[] = [];
  for (let dz = 0; dz < depth; dz++) {
    for (let dx = 0; dx < width; dx++) tiles.push(tileIndex(building.x + dx, building.z + dz));
  }
  return tiles;
}

export function perimeterTiles(building: Building): number[] {
  const own = new Set(footprintTiles(building));
  const result = new Set<number>();
  for (const tile of own) {
    for (const next of neighbours(tile)) if (!own.has(next)) result.add(next);
  }
  return [...result];
}

function* clockwiseRing(building: Building): Generator<number> {
  const { width, depth } = footprint(building.kind, building.rotation);
  const { x, z } = building;
  const points: [number, number][] = [];
  for (let d = 0; d < width; d++) points.push([x + d, z - 1]);
  for (let d = 0; d < depth; d++) points.push([x + width, z + d]);
  for (let d = width - 1; d >= 0; d--) points.push([x + d, z + depth]);
  for (let d = depth - 1; d >= 0; d--) points.push([x - 1, z + d]);
  for (const [tx, tz] of points) if (insideMap(tx, tz)) yield tileIndex(tx, tz);
}

export function exitTile(world: World, building: Building): number {
  const roads = new Set(world.roads);
  for (const tile of clockwiseRing(building)) if (roads.has(tile)) return tile;
  return -1;
}

export function accessTiles(world: World, building: Building): number[] {
  const roads = new Set(world.roads);
  return perimeterTiles(building).filter((tile) => roads.has(tile));
}

export function entryTileIndex(): number {
  return tileIndex(ENTRY.x, ENTRY.z);
}

export function bfsReachable(roads: Set<number>, start: number): Set<number> {
  const visited = new Set<number>([start]);
  const queue: number[] = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    for (const next of neighbours(current)) {
      if (visited.has(next) || !roads.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

export function bfsShortest(roads: Set<number>, start: number, isGoal: (tile: number) => boolean): number[] | null {
  if (isGoal(start)) return [start];
  const cameFrom = new Map<number, number>([[start, -1]]);
  const queue: number[] = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    for (const next of neighbours(current)) {
      if (cameFrom.has(next) || !roads.has(next)) continue;
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

export function buildServiceCircuit(world: World, start: number, budget: number): number[] {
  const roads = new Set(world.roads);
  if (!roads.has(start)) return [start];
  const visited = new Set<number>([start]);
  const path: number[] = [start];

  function visit(tile: number): boolean {
    if (visited.size >= budget) return false;
    for (const next of neighbours(tile)) {
      if (!roads.has(next) || visited.has(next)) continue;
      visited.add(next);
      path.push(next);
      const carryOn = visited.size >= budget ? false : visit(next);
      path.push(tile);
      if (!carryOn) return false;
    }
    return true;
  }

  const completed = visit(start);
  if (!completed) {
    const current = path[path.length - 1];
    if (current !== start) {
      const way = bfsShortest(roads, current, (tile) => tile === start);
      if (way) path.push(...way.slice(1));
    }
  }
  return path;
}

export function findNearestConnected(
  world: World,
  fromTile: number,
  candidates: Building[],
): { building: Building; path: number[] } | null {
  const roads = new Set(world.roads);
  let best: { building: Building; path: number[] } | null = null;
  for (const candidate of candidates) {
    const goals = new Set(accessTiles(world, candidate));
    if (goals.size === 0) continue;
    const path = bfsShortest(roads, fromTile, (tile) => goals.has(tile));
    if (!path) continue;
    if (!best || path.length < best.path.length || (path.length === best.path.length && candidate.id < best.building.id)) {
      best = { building: candidate, path };
    }
  }
  return best;
}
