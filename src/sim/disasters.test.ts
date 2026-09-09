import { describe, expect, test } from 'bun:test';
import { drown, floodTiles, landslideTiles, lavaTiles, scorch } from './disasters';
import { TERRAIN_ROCK, TERRAIN_SAND, TERRAIN_WATER } from './grid';
import { Grid } from './grid';
import { createRandom } from './mapgen';

function flatGrid(): Grid {
  const grid = new Grid(20);
  grid.terrain.fill(0);
  grid.height.fill(0);
  return grid;
}

describe('disasters', () => {
  test('a flood drowns the low ground around a shore, and it stays water', () => {
    const grid = flatGrid();
    for (let x = 4; x < 8; x++) grid.terrain[grid.index(x, 4)] = TERRAIN_SAND;
    grid.road[grid.index(5, 5)] = 1;

    const tiles = floodTiles(grid, createRandom(3));
    expect(tiles.length).toBeGreaterThan(0);

    drown(grid, tiles);
    for (const tile of tiles) expect(grid.terrain[tile]).toBe(TERRAIN_WATER);
    expect(grid.road[grid.index(5, 5)]).toBe(tiles.includes(grid.index(5, 5)) ? 0 : 1);
  });

  test('a landslide only takes ground that has a drop beside it', () => {
    const grid = flatGrid();
    for (let x = 2; x < 10; x++) for (let y = 2; y < 10; y++) grid.height[grid.index(x, y)] = 1;

    const tiles = landslideTiles(grid, createRandom(5));

    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) expect(grid.height[tile]).toBe(1);
  });

  test('lava leaves rock that nothing can be built on', () => {
    const grid = flatGrid();
    for (let x = 6; x < 12; x++) for (let y = 6; y < 12; y++) grid.height[grid.index(x, y)] = 2;

    const tiles = lavaTiles(grid, createRandom(9));
    scorch(grid, tiles);

    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(grid.terrain[tile]).toBe(TERRAIN_ROCK);
      expect(grid.isFree(grid.tileX(tile), grid.tileY(tile))).toBe(false);
    }
  });
});
