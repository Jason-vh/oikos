import { describe, expect, test } from 'bun:test';
import { Grid, TERRAIN_MEADOW, TERRAIN_ROCK, TERRAIN_WATER } from './grid';
import { LANDSCAPES, entryPoint, generateMap, landscapeFor } from './mapgen';

const SIZE = 90;

function mapOf(seed: number): Grid {
  const grid = new Grid(SIZE);
  generateMap(grid, seed);
  return grid;
}

function tilesOf(grid: Grid, terrain: number): number {
  return grid.terrain.reduce((count, tile) => count + (tile === terrain ? 1 : 0), 0);
}

describe('the lie of the land', () => {
  test('a seed always draws the same map', () => {
    expect([...mapOf(7).terrain]).toEqual([...mapOf(7).terrain]);
    expect([...mapOf(7).height]).toEqual([...mapOf(7).height]);
  });

  test('the landscape follows the seed, and there is more than one', () => {
    expect(landscapeFor(3)).toBe(LANDSCAPES[3 % LANDSCAPES.length]);
    expect(new Set(LANDSCAPES.map((land) => land.name)).size).toBe(LANDSCAPES.length);
  });

  test('every landscape leaves fields to farm, rock to quarry and water to fish', () => {
    for (let seed = 0; seed < LANDSCAPES.length; seed++) {
      const grid = mapOf(seed);

      expect(tilesOf(grid, TERRAIN_MEADOW)).toBeGreaterThan(0);
      expect(tilesOf(grid, TERRAIN_ROCK)).toBeGreaterThan(0);
      expect(tilesOf(grid, TERRAIN_WATER)).toBeGreaterThan(0);
    }
  });

  test('every landscape leaves dry ground at the edge for the settlers to walk in', () => {
    for (let seed = 0; seed < LANDSCAPES.length * 3; seed++) {
      const grid = mapOf(seed);
      const entry = entryPoint(grid, seed);

      expect(grid.isLand(grid.tileX(entry), grid.tileY(entry))).toBe(true);
    }
  });

  test('hills rise where the landscape is high and lie flat where it is not', () => {
    const highest = LANDSCAPES.findIndex((land) => land.name === 'the high country');
    const flattest = LANDSCAPES.findIndex((land) => land.name === 'a wide plain');
    const raised = (grid: Grid) => grid.height.reduce((total, step) => total + step, 0);

    expect(raised(mapOf(highest))).toBeGreaterThan(raised(mapOf(flattest)) * 2);
  });
});
