import type { Terrain, Tile } from './types';

export const MAP_WIDTH = 40;
export const MAP_DEPTH = 32;
export const CELL_SIZE = 1.25;
export const GROUND_Y = 1.15;
export const ENTRY: Tile = { x: 21, z: 24 };
export const COAST: [number, number][] = [[2, 15], [3, 8], [8, 4], [14, 2], [23, 3], [32, 4], [37, 10], [36, 17], [32, 22], [27, 25], [18, 27], [10, 25], [4, 21]];
export const HILL: [number, number][] = [[7, 8], [11, 4], [16, 4], [18, 8], [16, 11], [10, 11]];

export function tileIndex(x: number, z: number): number { return z * MAP_WIDTH + x; }
export function tileAt(index: number): Tile { return { x: index % MAP_WIDTH, z: Math.floor(index / MAP_WIDTH) }; }
export function insideMap(x: number, z: number): boolean {
  return Number.isInteger(x) && Number.isInteger(z) && x >= 0 && z >= 0 && x < MAP_WIDTH && z < MAP_DEPTH;
}
export function contains(polygon: [number, number][], x: number, z: number): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) result = !result;
  }
  return result;
}
export function terrainAt(x: number, z: number): Terrain {
  if (!insideMap(x, z)) return 'water';
  const corners = [[x + .05, z + .05], [x + .95, z + .05], [x + .05, z + .95], [x + .95, z + .95]];
  if (!corners.every(([cx, cz]) => contains(COAST, cx, cz))) return 'water';
  if (corners.some(([cx, cz]) => contains(HILL, cx, cz))) return 'hill';
  if (x >= 26 && x <= 34 && z >= 7 && z <= 16) return 'fertile';
  return 'grass';
}
export function worldPosition(x: number, z: number): { x: number; z: number } {
  return { x: (x - MAP_WIDTH / 2) * CELL_SIZE, z: (z - MAP_DEPTH / 2) * CELL_SIZE };
}
