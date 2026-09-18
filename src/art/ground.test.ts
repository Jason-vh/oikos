import { expect, test } from 'bun:test';
import { generateIsland, soleIsland, terrainOn, type IslandMap } from '../sim/island';
import { GROUND_KINDS, blendedTiles, groundMix, groundShare } from './ground';
import type { Terrain } from '../sim/types';

const REACH = 2;

function patchwork(): IslandMap {
  const terrain: Terrain[] = Array.from({ length: 16 * 16 }, (_, index) => (index % 16 < 8 ? 'grass' : 'sand'));
  return soleIsland({ seed: 5, width: 16, depth: 16, terrain, level: new Uint8Array(16 * 16), entry: { x: 0, z: 0 } });
}

function terraced(): IslandMap {
  const level = new Uint8Array(16 * 16);
  const terrain: Terrain[] = Array.from({ length: 16 * 16 }, (_, index) => (index % 16 < 8 ? 'grass' : 'rock'));
  for (let index = 0; index < level.length; index++) level[index] = index % 16 < 8 ? 0 : 1;
  return soleIsland({ seed: 5, width: 16, depth: 16, terrain, level, entry: { x: 0, z: 0 } });
}

test('every mix is a share of one, repeatable, and made only of the kinds nearby', () => {
  const map = generateIsland(1);
  const shares = new Float32Array(GROUND_KINDS.length);
  const repeated = new Float32Array(GROUND_KINDS.length);
  for (let z = 1; z < map.depth; z += 3) {
    for (let x = 1; x < map.width; x += 3) {
      const terrain = terrainOn(map, x, z);
      if (terrain === 'water') continue;
      const level = map.level[z * map.width + x];
      for (const [u, v] of [[.5, .5], [0, 0], [1, .5]]) {
        expect(groundMix(map, x + u, z + v, level, shares)).toBe(groundMix(map, x + u, z + v, level, repeated));
        expect(Array.from(shares)).toEqual(Array.from(repeated));
        if (!groundMix(map, x + u, z + v, level, shares)) continue;
        expect([...shares].reduce((total, share) => total + share, 0)).toBeCloseTo(1, 6);
        for (let kind = 0; kind < shares.length; kind++) {
          if (shares[kind] === 0) continue;
          let found = false;
          for (let dz = -REACH; dz <= REACH; dz++) {
            for (let dx = -REACH; dx <= REACH; dx++) {
              if (terrainOn(map, x + dx, z + dz) === GROUND_KINDS[kind]) found = true;
            }
          }
          expect(found).toBe(true);
        }
      }
    }
  }
});

test('ground away from a border is its own colour, and the border is a band that crosses tiles', () => {
  const map = patchwork();
  expect(groundShare(map, 3.5, 8.5, 0, 'grass')).toBe(1);
  expect(groundShare(map, 12.5, 8.5, 0, 'sand')).toBe(1);
  const border: number[] = [];
  for (let z = 2; z < 14; z += .5) {
    for (let x = 6.5; x < 9.5; x += .02) {
      expect(groundShare(map, x, z, 0, 'grass') + groundShare(map, x, z, 0, 'sand')).toBeCloseTo(1, 6);
      if (groundShare(map, x, z, 0, 'sand') >= .5) {
        border.push(x);
        break;
      }
    }
  }
  expect(border.length).toBeGreaterThan(20);
  expect(Math.max(...border) - Math.min(...border)).toBeGreaterThan(.3);
  expect(border.some((x) => x < 8)).toBe(true);
  expect(border.some((x) => x > 8)).toBe(true);
});

test('a terrace edge keeps its line: ground never blends across levels', () => {
  const map = terraced();
  for (let z = 2; z < 14; z++) {
    expect(groundShare(map, 7.9, z + .5, 0, 'rock')).toBe(0);
    expect(groundShare(map, 8.1, z + .5, 1, 'grass')).toBe(0);
  }
});

test('only tiles near a different kind are blended, and the island is never touched', () => {
  for (const seed of [1, 8]) {
    const map = generateIsland(seed);
    const before = structuredClone(map);
    const mixed = blendedTiles(map);
    let plain = 0;
    for (let z = 0; z < map.depth; z++) {
      for (let x = 0; x < map.width; x++) {
        const terrain = terrainOn(map, x, z);
        if (terrain === 'water') {
          expect(mixed[z * map.width + x]).toBe(0);
          continue;
        }
        const level = map.level[z * map.width + x];
        let uniform = true;
        for (let dz = -REACH; dz <= REACH; dz++) {
          for (let dx = -REACH; dx <= REACH; dx++) {
            const nx = x + dx;
            const nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= map.width || nz >= map.depth) continue;
            if (map.level[nz * map.width + nx] !== level) continue;
            if (terrainOn(map, nx, nz) !== terrain && terrainOn(map, nx, nz) !== 'water') uniform = false;
          }
        }
        expect(mixed[z * map.width + x]).toBe(uniform ? 0 : 1);
        if (uniform) plain++;
      }
    }
    expect(plain).toBeGreaterThan(0);
    expect(map).toEqual(before);
  }
});
