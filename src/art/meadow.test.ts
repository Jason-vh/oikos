import { expect, test } from 'bun:test';
import * as T from 'three';
import { CELL_SIZE, generateIsland, soleIsland, terrainOn, type IslandMap } from '../sim/island';
import { meadowForTile, meadowHalo, soilAt, wildflower } from './meadow';
import { bake, colors, disposeModel, material } from './primitives';

const FLOWER_SPAN = .24;

function vertices(model: T.Group): number[][] {
  return model.children.map((child) => Array.from((child as T.Mesh).geometry.attributes.position.array));
}

function meadow(seed: number): IslandMap {
  return soleIsland({
    seed,
    width: 48,
    depth: 48,
    terrain: Array.from({ length: 48 * 48 }, () => 'fertile'),
    level: new Uint8Array(48 * 48),
    entry: { x: 0, z: 0 },
  });
}

test('a wildflower is a small bloom close to the ground', () => {
  for (const accent of [false, true]) {
    const model = wildflower(accent);
    bake(model);
    try {
      expect(model.children).toHaveLength(1);
      for (const child of model.children as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>[]) {
        expect([material(colors.bloom), material(colors.bloomLight)]).toContain(child.material);
      }
      const bounds = new T.Box3().setFromObject(model);
      expect(bounds.max.y).toBeLessThan(.09);
      expect(bounds.min.y).toBeLessThan(0);
      for (const axis of ['x', 'z'] as const) {
        expect(bounds.max[axis] - bounds.min[axis]).toBeLessThan(FLOWER_SPAN);
      }
    } finally {
      disposeModel(model);
    }
  }
});

test('soil fills a patch, fades across its rim and is gone beyond the halo', () => {
  for (const seed of [1, 2, 8, 37]) {
    const map = generateIsland(seed);
    const before = structuredClone(map);
    const halo = meadowHalo(map);
    let full = 0;
    let fading = 0;
    for (let z = 0; z < map.depth; z++) {
      for (let x = 0; x < map.width; x++) {
        const level = map.level[z * map.width + x];
        const corners = [[0, 0], [1, 0], [0, 1], [1, 1], [.5, .5]].map(([u, v]) => soilAt(map, x + u, z + v, level));
        expect(corners).toEqual([[0, 0], [1, 0], [0, 1], [1, 1], [.5, .5]].map(([u, v]) => soilAt(map, x + u, z + v, level)));
        for (const soil of corners) {
          expect(soil).toBeGreaterThanOrEqual(0);
          expect(soil).toBeLessThanOrEqual(1);
        }
        const terrain = terrainOn(map, x, z);
        const paved = terrain === 'water' || terrain === 'cliff' || terrain === 'rock';
        if (!paved && corners.some((soil) => soil > 0)) expect(halo[z * map.width + x]).toBe(1);
        if (terrain !== 'fertile') continue;
        if (corners.every((soil) => soil === 1)) full++;
        else fading++;
      }
    }
    expect(full).toBeGreaterThan(0);
    expect(fading).toBeGreaterThan(0);
    expect(map).toEqual(before);
  }
});

test('wildflowers stand only in full soil, spill past the fertile tiles and stay inside their own', () => {
  let beyondFertile = 0;
  for (const seed of [1, 2, 8, 37]) {
    const map = generateIsland(seed);
    const before = structuredClone(map);
    let onFertile = 0;
    for (let z = 0; z < map.depth; z++) {
      for (let x = 0; x < map.width; x++) {
        const plants = meadowForTile(map, x, z);
        const terrain = terrainOn(map, x, z);
        if (!plants) continue;
        expect(['fertile', 'grass']).toContain(terrain);
        if (terrain === 'fertile') onFertile++;
        else beyondFertile++;
        const level = map.level[z * map.width + x];
        for (const plant of plants.children) {
          expect(soilAt(map, x + .5 + plant.position.x / CELL_SIZE, z + .5 + plant.position.z / CELL_SIZE, level)).toBe(1);
          const height = new T.Box3().setFromObject(plant).max.y;
          if (plant.children.length === 1) expect(height).toBeLessThan(.15);
          else expect(height).toBeLessThan(.45);
        }
        const repeated = meadowForTile(map, x, z)!;
        bake(plants);
        bake(repeated);
        try {
          expect(vertices(plants)).toEqual(vertices(repeated));
          const bounds = new T.Box3().setFromObject(plants);
          expect(bounds.max.y).toBeLessThan(.45);
          for (const axis of ['x', 'z'] as const) {
            expect(bounds.min[axis]).toBeGreaterThan(-CELL_SIZE / 2);
            expect(bounds.max[axis]).toBeLessThan(CELL_SIZE / 2);
          }
        } finally {
          disposeModel(plants);
          disposeModel(repeated);
        }
      }
    }
    expect(onFertile).toBeGreaterThan(50);
    expect(map).toEqual(before);
  }
  expect(beyondFertile).toBeGreaterThan(10);
});

test('a bush stands in the meadow now and then, never often', () => {
  const map = generateIsland(1);
  let tiles = 0;
  let bushes = 0;
  for (let z = 0; z < map.depth; z++) {
    for (let x = 0; x < map.width; x++) {
      const plants = meadowForTile(map, x, z);
      if (!plants) continue;
      tiles++;
      if (plants.children.some((plant) => plant.children.length > 1)) bushes++;
      disposeModel(plants);
    }
  }
  expect(bushes / tiles).toBeGreaterThan(.01);
  expect(bushes / tiles).toBeLessThan(.1);
});

test('deep soil blooms everywhere, in seeded patches of differing density', () => {
  const layouts: number[][] = [];
  for (const seed of [1, 2, 8, 37]) {
    const map = meadow(seed);
    const counts: number[] = [];
    for (let z = 4; z < map.depth - 4; z++) {
      for (let x = 4; x < map.width - 4; x++) {
        const plants = meadowForTile(map, x, z);
        counts.push(plants?.children.length ?? 0);
        if (plants) disposeModel(plants);
      }
    }
    const bare = counts.filter((count) => count === 0).length;
    const sown = counts.reduce((total, count) => total + count, 0) / counts.length;
    expect(bare).toBe(0);
    expect(sown).toBeGreaterThan(1.5);
    expect(sown).toBeLessThan(3.5);
    expect(Math.max(...counts)).toBeGreaterThan(Math.min(...counts) + 1);
    layouts.push(counts);
  }
  for (let index = 1; index < layouts.length; index++) expect(layouts[index]).not.toEqual(layouts[0]);
});
