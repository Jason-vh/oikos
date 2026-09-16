import { expect, test } from 'bun:test';
import { generateIsland } from '../sim/island';
import { shoreTexture } from './sea';

const SHALLOW_CELLS = 46;

function trueDistanceToLand(map: ReturnType<typeof generateIsland>, x: number, z: number): number {
  let nearest = Infinity;
  for (let landZ = 0; landZ < map.depth; landZ++) {
    for (let landX = 0; landX < map.width; landX++) {
      if (map.terrain[landZ * map.width + landX] === 'water') continue;
      nearest = Math.min(nearest, Math.hypot(landX - x, landZ - z));
    }
  }
  return nearest;
}

test('the shore field tracks the real distance to land', () => {
  const map = generateIsland(3, 44, 36);
  const shallows = shoreTexture(map).image.data as Uint8Array;
  expect(shallows.length).toBe(map.width * map.depth);

  let checked = 0;
  for (let z = 0; z < map.depth; z += 3) {
    for (let x = 0; x < map.width; x += 3) {
      const expected = Math.max(0, 1 - trueDistanceToLand(map, x, z) / SHALLOW_CELLS) * 255;
      expect(Math.abs(shallows[z * map.width + x] - expected)).toBeLessThan(8);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(50);
});

test('land reads fully shallow and open water reads deep', () => {
  const map = generateIsland(1);
  const shallows = shoreTexture(map).image.data as Uint8Array;
  const land = map.terrain.findIndex((terrain) => terrain !== 'water');
  expect(shallows[land]).toBe(255);
  expect(shallows.some((value) => value === 0)).toBe(true);
  const shore = map.terrain.findIndex((terrain, index) => terrain === 'water' && map.terrain[index + 1] !== 'water');
  expect(shallows[shore]).toBeGreaterThan(240);
});
