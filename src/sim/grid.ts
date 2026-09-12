import type { Building, World } from './types';
import { footprint } from './catalog';
import { islandFor, insideMapOn, tileAtOn, tileIndexOn, type IslandMap } from './island';
import { doorTiles, roadStepAllowed, stairLayout } from './stairs';

export function mapOf(world: World): IslandMap {
  return islandFor(world.seed, world.home);
}

export function neighbours(map: IslandMap, tile: number): number[] {
  const { x, z } = tileAtOn(map, tile);
  const result: number[] = [];
  if (insideMapOn(map, x, z - 1)) result.push(tileIndexOn(map, x, z - 1));
  if (insideMapOn(map, x + 1, z)) result.push(tileIndexOn(map, x + 1, z));
  if (insideMapOn(map, x, z + 1)) result.push(tileIndexOn(map, x, z + 1));
  if (insideMapOn(map, x - 1, z)) result.push(tileIndexOn(map, x - 1, z));
  return result;
}

export function footprintTiles(map: IslandMap, building: Building): number[] {
  const { width, depth } = footprint(building.kind, building.rotation);
  const tiles: number[] = [];
  for (let dz = 0; dz < depth; dz++) {
    for (let dx = 0; dx < width; dx++) tiles.push(tileIndexOn(map, building.x + dx, building.z + dz));
  }
  return tiles;
}

export function perimeterTiles(map: IslandMap, building: Building): number[] {
  const own = new Set(footprintTiles(map, building));
  const result = new Set<number>();
  for (const tile of own) {
    for (const next of neighbours(map, tile)) if (!own.has(next)) result.add(next);
  }
  return [...result];
}

export function accessDoors(map: IslandMap, roads: ReadonlySet<number>, building: Building): number[] {
  const stairs = stairLayout(map, roads);
  return doorTiles(map, stairs, new Set(footprintTiles(map, building)));
}

function* clockwiseRing(map: IslandMap, building: Building): Generator<number> {
  const { width, depth } = footprint(building.kind, building.rotation);
  const { x, z } = building;
  const points: [number, number][] = [];
  for (let d = 0; d < width; d++) points.push([x + d, z - 1]);
  for (let d = 0; d < depth; d++) points.push([x + width, z + d]);
  for (let d = width - 1; d >= 0; d--) points.push([x + d, z + depth]);
  for (let d = depth - 1; d >= 0; d--) points.push([x - 1, z + d]);
  for (const [tx, tz] of points) if (insideMapOn(map, tx, tz)) yield tileIndexOn(map, tx, tz);
}

export function accessTiles(world: World, building: Building): number[] {
  const map = mapOf(world);
  const roads = new Set(world.roads);
  return accessDoors(map, roads, building).filter((tile) => roads.has(tile));
}

export function exitTile(world: World, building: Building): number {
  const map = mapOf(world);
  const doors = new Set(accessTiles(world, building));
  for (const tile of clockwiseRing(map, building)) {
    if (doors.has(tile)) return tile;
  }
  return -1;
}

export function entryTileIndex(world: World): number {
  const map = mapOf(world);
  return tileIndexOn(map, map.entry.x, map.entry.z);
}

export function bfsReachable(map: IslandMap, roads: ReadonlySet<number>, start: number): Set<number> {
  const stairs = stairLayout(map, roads);
  const visited = new Set<number>([start]);
  const queue: number[] = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    for (const next of neighbours(map, current)) {
      if (visited.has(next) || !roads.has(next) || !roadStepAllowed(map, stairs, current, next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

export function bfsShortest(map: IslandMap, roads: ReadonlySet<number>, start: number, isGoal: (tile: number) => boolean): number[] | null {
  if (isGoal(start)) return [start];
  const stairs = stairLayout(map, roads);
  const cameFrom = new Map<number, number>([[start, -1]]);
  const queue: number[] = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    for (const next of neighbours(map, current)) {
      if (cameFrom.has(next) || !roads.has(next) || !roadStepAllowed(map, stairs, current, next)) continue;
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
  const map = mapOf(world);
  const roads = new Set(world.roads);
  const stairs = stairLayout(map, roads);
  if (!roads.has(start)) return [start];
  const visited = new Set<number>([start]);
  const path: number[] = [start];

  function visit(tile: number): boolean {
    if (visited.size >= budget) return false;
    for (const next of neighbours(map, tile)) {
      if (!roads.has(next) || visited.has(next) || !roadStepAllowed(map, stairs, tile, next)) continue;
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
      const way = bfsShortest(map, roads, current, (tile) => tile === start);
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
  const map = mapOf(world);
  const roads = new Set(world.roads);
  let best: { building: Building; path: number[] } | null = null;
  for (const candidate of candidates) {
    const goals = new Set(accessTiles(world, candidate));
    if (goals.size === 0) continue;
    const path = bfsShortest(map, roads, fromTile, (tile) => goals.has(tile));
    if (!path) continue;
    if (!best || path.length < best.path.length || (path.length === best.path.length && candidate.id < best.building.id)) {
      best = { building: candidate, path };
    }
  }
  return best;
}
