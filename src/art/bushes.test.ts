import { expect, test } from 'bun:test';
import * as T from 'three';
import { CELL_SIZE, generateIsland, type IslandMap } from '../sim/island';
import { BUSH_SHAPES, bush, bushForTile } from './bushes';
import { bake, colors, disposeModel, material } from './primitives';

function vertices(model: T.Group): number[][] {
  return model.children.map((child) => Array.from((child as T.Mesh).geometry.attributes.position.array));
}

function scrubland(seed: number): IslandMap {
  return {
    seed,
    width: 48,
    depth: 48,
    terrain: Array.from({ length: 48 * 48 }, () => 'scrub'),
    level: new Uint8Array(48 * 48),
    entry: { x: 0, z: 0 },
  };
}

test('bush silhouettes are distinct, grounded and contained at every rotation', () => {
  const heights: number[] = [];
  for (const shape of BUSH_SHAPES) {
    for (const sunlit of [false, true]) {
      const model = bush(shape, sunlit);
      bake(model);
      try {
        expect(model.children).toHaveLength(2);
        expect(vertices(model).flat().length / 9).toBeLessThanOrEqual(108);
        for (const child of model.children as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>[]) {
          expect([material(colors.olive), material(colors.oliveDark), material(colors.oliveLight)]).toContain(child.material);
          const positions = child.geometry.attributes.position;
          for (let vertex = 0; vertex < positions.count; vertex++) {
            expect(Math.hypot(positions.getX(vertex), positions.getZ(vertex))).toBeLessThan(.5);
          }
        }
        for (let turn = 0; turn < 32; turn++) {
          model.rotation.y = turn / 32 * Math.PI * 2;
          const bounds = new T.Box3().setFromObject(model);
          expect(bounds.min.y).toBeLessThan(0);
          for (const axis of ['x', 'z'] as const) {
            expect(bounds.min[axis]).toBeGreaterThan(-CELL_SIZE / 2);
            expect(bounds.max[axis]).toBeLessThan(CELL_SIZE / 2);
          }
        }
        if (!sunlit) heights.push(new T.Box3().setFromObject(model).max.y);
      } finally {
        disposeModel(model);
      }
    }
  }
  expect(heights[0]).toBeLessThan(.45);
  expect(heights[1]).toBeGreaterThan(.65);
  expect(heights[2]).toBeGreaterThan(.48);
  expect(heights[2]).toBeLessThan(.6);
});

test('seeded bush placement stays inside its tile and never changes the island', () => {
  for (const seed of [1, 2, 8, 37]) {
    const map = generateIsland(seed);
    const before = structuredClone(map);
    let count = 0;
    for (let z = 0; z < map.depth; z++) {
      for (let x = 0; x < map.width; x++) {
        const plant = bushForTile(map, x, z);
        const repeated = bushForTile(map, x, z);
        if (!plant) {
          expect(repeated).toBeNull();
          continue;
        }
        count++;
        bake(plant);
        bake(repeated!);
        try {
          expect(vertices(plant)).toEqual(vertices(repeated!));
          expect(vertices(plant).flat().every(Number.isFinite)).toBe(true);
          const bounds = new T.Box3().setFromObject(plant);
          expect(bounds.min.y).toBeLessThan(0);
          expect(bounds.max.y).toBeLessThan(.85);
          for (const axis of ['x', 'z'] as const) {
            expect(bounds.min[axis]).toBeGreaterThan(-CELL_SIZE / 2 + .04);
            expect(bounds.max[axis]).toBeLessThan(CELL_SIZE / 2 - .04);
          }
          if (map.terrain[z * map.width + x] === 'cliff') expect(bounds.max.y).toBeLessThan(.3);
          else expect(map.terrain[z * map.width + x]).toBe('scrub');
        } finally {
          disposeModel(plant);
          disposeModel(repeated!);
        }
      }
    }
    expect(count).toBeGreaterThan(50);
    expect(map).toEqual(before);
  }
});

test('scrub forms seeded pockets with clear ground between them', () => {
  const layouts: number[][] = [];
  for (const seed of [1, 2, 8, 37]) {
    const map = scrubland(seed);
    const occupied = new Set<number>();
    for (let z = 0; z < map.depth; z++) {
      for (let x = 0; x < map.width; x++) {
        const plant = bushForTile(map, x, z);
        if (!plant) continue;
        occupied.add(z * map.width + x);
        disposeModel(plant);
      }
    }
    const coverage = occupied.size / map.terrain.length;
    expect(coverage).toBeGreaterThan(.2);
    expect(coverage).toBeLessThan(.55);
    let neighbours = 0;
    let plantedNeighbours = 0;
    for (const index of occupied) {
      const x = index % map.width;
      const z = Math.floor(index / map.width);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (x + dx < 0 || x + dx >= map.width || z + dz < 0 || z + dz >= map.depth) continue;
        neighbours++;
        if (occupied.has((z + dz) * map.width + x + dx)) plantedNeighbours++;
      }
    }
    expect(plantedNeighbours / neighbours).toBeGreaterThan(coverage * 1.2);
    layouts.push([...occupied]);
  }
  for (let index = 1; index < layouts.length; index++) expect(layouts[index]).not.toEqual(layouts[0]);
});

test('baked bushes own geometry but never dispose palette materials', () => {
  const model = bush('upright', true);
  bake(model);
  let geometryDisposals = 0;
  let materialDisposals = 0;
  const onMaterialDisposed = () => { materialDisposals++; };
  for (const mesh of model.children as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>[]) {
    mesh.geometry.addEventListener('dispose', () => { geometryDisposals++; });
    mesh.material.addEventListener('dispose', onMaterialDisposed);
  }
  disposeModel(model);
  expect(geometryDisposals).toBe(2);
  expect(materialDisposals).toBe(0);
  for (const mesh of model.children as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>[]) mesh.material.removeEventListener('dispose', onMaterialDisposed);
});
