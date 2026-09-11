import { LEVEL_HEIGHT, groundHeight, insideMapOn, levelOn, terrainOn, tileAtOn, tileIndexOn, type IslandMap } from './island';

export const STAIR_STEPS = 8;

export interface Stair { tile: number; down: number; up: number; dx: number; dz: number }

export type StairIssue = 'ambiguous' | 'backland' | 'side';

const DIRECTIONS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

interface DownEdge { down: number; dx: number; dz: number }

function stairDownEdges(map: IslandMap, roads: ReadonlySet<number>, tile: number): DownEdge[] {
  const { x, z } = tileAtOn(map, tile);
  if (terrainOn(map, x, z) !== 'cliff') return [];
  const level = levelOn(map, x, z);
  const edges: DownEdge[] = [];
  for (const [ddx, ddz] of DIRECTIONS) {
    const lx = x + ddx;
    const lz = z + ddz;
    if (!insideMapOn(map, lx, lz)) continue;
    if (levelOn(map, lx, lz) !== level - 1) continue;
    const downIndex = tileIndexOn(map, lx, lz);
    if (!roads.has(downIndex)) continue;
    edges.push({ down: downIndex, dx: -ddx + 0, dz: -ddz + 0 });
  }
  return edges;
}

function stairBacklandOk(map: IslandMap, tile: number, dx: number, dz: number): boolean {
  const { x, z } = tileAtOn(map, tile);
  const ux = x + dx;
  const uz = z + dz;
  if (!insideMapOn(map, ux, uz)) return false;
  if (terrainOn(map, ux, uz) === 'water') return false;
  return levelOn(map, ux, uz) >= levelOn(map, x, z);
}

function stairCandidates(map: IslandMap, roads: ReadonlySet<number>, tile: number): Stair[] {
  const { x, z } = tileAtOn(map, tile);
  return stairDownEdges(map, roads, tile)
    .filter((edge) => stairBacklandOk(map, tile, edge.dx, edge.dz))
    .map((edge) => ({ tile, down: edge.down, up: tileIndexOn(map, x + edge.dx, z + edge.dz), dx: edge.dx, dz: edge.dz }));
}

export function stairLayout(map: IslandMap, roads: ReadonlySet<number>): Map<number, Stair> {
  const stairs = new Map<number, Stair>();
  for (const tile of roads) {
    if (stairDownEdges(map, roads, tile).length !== 1) continue;
    const candidates = stairCandidates(map, roads, tile);
    if (candidates.length === 1) stairs.set(tile, candidates[0]);
  }
  return stairs;
}

export function stairPlacementConflict(map: IslandMap, roads: ReadonlySet<number>, tile: number): StairIssue | null {
  const raw = stairDownEdges(map, roads, tile);
  if (raw.length > 1) return 'ambiguous';
  if (raw.length === 0) return null;
  const candidates = stairCandidates(map, roads, tile);
  if (candidates.length === 0) return 'backland';
  const { dx } = candidates[0];
  const { x, z } = tileAtOn(map, tile);
  const laterals: [number, number][] = dx !== 0 ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
  for (const [lx, lz] of laterals) {
    const nx = x + lx;
    const nz = z + lz;
    if (insideMapOn(map, nx, nz) && roads.has(tileIndexOn(map, nx, nz))) return 'side';
  }
  return null;
}

function tileInBounds(map: IslandMap, tile: number): boolean {
  return Number.isInteger(tile) && tile >= 0 && tile < map.width * map.depth;
}

function areCardinalNeighbours(map: IslandMap, from: number, to: number): boolean {
  const a = tileAtOn(map, from);
  const b = tileAtOn(map, to);
  const dx = Math.abs(a.x - b.x);
  const dz = Math.abs(a.z - b.z);
  return (dx === 1 && dz === 0) || (dx === 0 && dz === 1);
}

function boundaryLevel(map: IslandMap, stairs: ReadonlyMap<number, Stair>, tile: number, neighbour: number): number | null {
  const { x, z } = tileAtOn(map, tile);
  const nominal = levelOn(map, x, z);
  const stair = stairs.get(tile);
  if (!stair) return nominal;
  if (neighbour === stair.down) return nominal - 1;
  if (neighbour === stair.up) return nominal;
  return null;
}

export function roadStepAllowed(map: IslandMap, stairs: ReadonlyMap<number, Stair>, from: number, to: number): boolean {
  if (!tileInBounds(map, from) || !tileInBounds(map, to)) return false;
  if (!areCardinalNeighbours(map, from, to)) return false;
  const fromBoundary = boundaryLevel(map, stairs, from, to);
  const toBoundary = boundaryLevel(map, stairs, to, from);
  return fromBoundary !== null && fromBoundary === toBoundary;
}

export function mixedEdgeAllowed(map: IslandMap, roads: ReadonlySet<number>, stairs: ReadonlyMap<number, Stair>, from: number, to: number): boolean {
  if (!tileInBounds(map, from) || !tileInBounds(map, to)) return false;
  if (!areCardinalNeighbours(map, from, to)) return false;
  if ((roads.has(from) && roads.has(to)) || stairs.has(from) || stairs.has(to)) return roadStepAllowed(map, stairs, from, to);
  const a = tileAtOn(map, from);
  const b = tileAtOn(map, to);
  const difference = Math.abs(levelOn(map, a.x, a.z) - levelOn(map, b.x, b.z));
  return difference === 0 || (difference === 1 && (terrainOn(map, a.x, a.z) === 'cliff' || terrainOn(map, b.x, b.z) === 'cliff'));
}

function stairProgress(stair: Stair, fx: number, fz: number): number {
  if (stair.dx > 0) return fx;
  if (stair.dx < 0) return 1 - fx;
  if (stair.dz > 0) return fz;
  return 1 - fz;
}

export function roadHeight(map: IslandMap, stairs: ReadonlyMap<number, Stair>, x: number, z: number): number {
  const tx = Math.floor(x);
  const tz = Math.floor(z);
  if (!insideMapOn(map, tx, tz)) return groundHeight(map, tx, tz);
  const stair = stairs.get(tileIndexOn(map, tx, tz));
  if (!stair) return groundHeight(map, tx, tz);
  const progress = stairProgress(stair, x - tx, z - tz);
  const clamped = Math.min(1, Math.max(0, progress));
  const step = Math.min(STAIR_STEPS, Math.floor(clamped * STAIR_STEPS) + 1);
  return groundHeight(map, tx, tz) - LEVEL_HEIGHT + (step / STAIR_STEPS) * LEVEL_HEIGHT;
}

function landsFlushAt(map: IslandMap, stair: Stair, ownTile: number): boolean {
  if (stair.up !== ownTile) return false;
  const { x: tx, z: tz } = tileAtOn(map, stair.tile);
  const { x: ux, z: uz } = tileAtOn(map, ownTile);
  return levelOn(map, ux, uz) === levelOn(map, tx, tz);
}

export function doorTiles(map: IslandMap, stairs: ReadonlyMap<number, Stair>, ownTiles: ReadonlySet<number>): number[] {
  const result = new Set<number>();
  for (const tile of ownTiles) {
    const { x, z } = tileAtOn(map, tile);
    for (const [dx, dz] of DIRECTIONS) {
      const nx = x + dx;
      const nz = z + dz;
      if (!insideMapOn(map, nx, nz)) continue;
      const next = tileIndexOn(map, nx, nz);
      if (ownTiles.has(next)) continue;
      const stair = stairs.get(next);
      if (stair && !landsFlushAt(map, stair, tile)) continue;
      result.add(next);
    }
  }
  return [...result];
}
