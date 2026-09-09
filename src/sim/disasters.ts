import { TERRAIN_ROCK, TERRAIN_SAND, TERRAIN_WATER } from './grid';
import type { Grid } from './grid';

export type Disaster = 'earthquake' | 'flood' | 'landslide' | 'lava';

export const FLOOD_RADIUS = 3;
export const LANDSLIDE_TILES = 12;
export const LAVA_TILES = 16;

export function floodTiles(grid: Grid, random: () => number): number[] {
  const shore = tilesWhere(grid, (index) => grid.terrain[index] === TERRAIN_SAND);
  if (shore.length === 0) return [];

  const centre = shore[Math.floor(random() * shore.length)];
  const cx = grid.tileX(centre);
  const cy = grid.tileY(centre);
  const drowned: number[] = [];

  for (let dy = -FLOOD_RADIUS; dy <= FLOOD_RADIUS; dy++) {
    for (let dx = -FLOOD_RADIUS; dx <= FLOOD_RADIUS; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!grid.contains(x, y) || Math.abs(dx) + Math.abs(dy) > FLOOD_RADIUS) continue;
      const index = grid.index(x, y);
      if (grid.terrain[index] === TERRAIN_WATER || grid.height[index] > 0) continue;
      drowned.push(index);
    }
  }
  return drowned;
}

export function landslideTiles(grid: Grid, random: () => number): number[] {
  const ledges = tilesWhere(grid, (index) => {
    if (grid.height[index] === 0) return false;
    return grid.neighbours(index).some((neighbour) => grid.height[neighbour] < grid.height[index]);
  });
  return pick(ledges, LANDSLIDE_TILES, random);
}

export function lavaTiles(grid: Grid, random: () => number): number[] {
  const highest = tilesWhere(grid, (index) => grid.height[index] >= 1);
  const source = pick(highest, 1, random);
  if (source.length === 0) return [];

  const cx = grid.tileX(source[0]);
  const cy = grid.tileY(source[0]);
  const burnt: number[] = [];

  for (let step = 0; step < LAVA_TILES; step++) {
    const x = cx + Math.floor(random() * 5) - 2;
    const y = cy + step - Math.floor(LAVA_TILES / 2);
    if (!grid.contains(x, y)) continue;
    const index = grid.index(x, y);
    if (grid.terrain[index] === TERRAIN_WATER) continue;
    burnt.push(index);
  }
  return burnt;
}

export function drown(grid: Grid, tiles: number[]): void {
  for (const index of tiles) {
    grid.terrain[index] = TERRAIN_WATER;
    grid.road[index] = 0;
    grid.roadblock[index] = 0;
    grid.wall[index] = 0;
    grid.decor[index] = 0;
  }
}

export function scorch(grid: Grid, tiles: number[]): void {
  for (const index of tiles) {
    grid.terrain[index] = TERRAIN_ROCK;
    grid.road[index] = 0;
    grid.roadblock[index] = 0;
    grid.wall[index] = 0;
    grid.decor[index] = 0;
  }
}

function tilesWhere(grid: Grid, matches: (index: number) => boolean): number[] {
  const found: number[] = [];
  for (let index = 0; index < grid.terrain.length; index++) if (matches(index)) found.push(index);
  return found;
}

function pick(from: number[], count: number, random: () => number): number[] {
  const taken: number[] = [];
  for (let step = 0; step < count && from.length > 0; step++) {
    taken.push(from[Math.floor(random() * from.length)]);
  }
  return taken;
}
