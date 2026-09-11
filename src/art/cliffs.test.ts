import { expect, test } from 'bun:test';
import * as T from 'three';
import { CELL_SIZE, GROUND_Y, LEVEL_HEIGHT, generateIsland, soleIsland, terrainOn, type IslandMap } from '../sim/island';
import { buildCliffs, cliffOutcrop } from './cliffs';
import { bake, colors, disposeModel, material } from './primitives';

function fixture(mask: number, tier = 1): IslandMap {
  return soleIsland({
    seed: 17,
    width: 5,
    depth: 5,
    terrain: Array.from({ length: 25 }, () => 'grass'),
    level: Uint8Array.from({ length: 25 }, (_, index) => {
      const x = index % 5 - 1;
      const z = Math.floor(index / 5) - 1;
      return x >= 0 && x < 3 && z >= 0 && z < 3 && mask & (1 << (z * 3 + x)) ? tier : 0;
    }),
    entry: { x: 0, z: 0 },
  });
}

function vertices(model: T.Group): number[] {
  return model.children.flatMap((child) => Array.from((child as T.Mesh).geometry.attributes.position.array));
}

function boundaryEdges(model: T.Group): number[][][] {
  const edges = new Map<string, { points: number[][]; count: number }>();
  const positions = vertices(model);
  for (let index = 0; index < positions.length; index += 9) {
    const points = [0, 3, 6].map((offset) => positions.slice(index + offset, index + offset + 3));
    for (let side = 0; side < 3; side++) {
      const pair = [points[side], points[(side + 1) % 3]];
      const key = pair.map((point) => point.map((value) => value.toFixed(5)).join(',')).sort().join(':');
      const existing = edges.get(key);
      if (existing) existing.count++;
      else edges.set(key, { points: pair, count: 1 });
    }
  }
  expect([...edges.values()].every((edge) => edge.count <= 2)).toBe(true);
  return [...edges.values()].filter((edge) => edge.count === 1).map((edge) => edge.points);
}

test('all terrace masks join without cracks, including two-level drops', () => {
  for (const tier of [1, 2]) {
    for (let mask = 0; mask < 512; mask++) {
      const cliffs = buildCliffs(fixture(mask, tier));
      try {
        for (const edge of boundaryEdges(cliffs)) {
          const rim = edge.every((point) => Math.abs(point[1] - GROUND_Y - tier * LEVEL_HEIGHT) < 1e-5);
          const foot = edge.every((point) => Math.abs(point[1] - GROUND_Y) < 1e-5);
          expect(rim || foot).toBe(true);
        }
      } finally {
        disposeModel(cliffs);
      }
    }
  }
});

test('carved faces remain visible from every side and stay inside the upper tile', () => {
  const cliffs = buildCliffs(fixture(16));
  cliffs.updateMatrixWorld(true);
  try {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const rise of [.1, .35, .65, .9]) {
        const ray = new T.Raycaster(new T.Vector3(dx * CELL_SIZE * 2, GROUND_Y + rise * LEVEL_HEIGHT, dz * CELL_SIZE * 2), new T.Vector3(-dx, 0, -dz));
        const hit = ray.intersectObject(cliffs, true)[0];
        expect(hit).toBeDefined();
        expect(Math.abs(hit.point.x)).toBeLessThanOrEqual(CELL_SIZE / 2);
        expect(Math.abs(hit.point.z)).toBeLessThanOrEqual(CELL_SIZE / 2);
      }
    }
  } finally {
    disposeModel(cliffs);
  }
});

test('mixed terraces leave boundaries only at ground heights and coastal junctions', () => {
  for (const seed of [1, 2, 8, 37]) {
    const map = generateIsland(seed);
    const cliffs = buildCliffs(map);
    try {
      for (const [a, b] of boundaryEdges(cliffs)) {
        const horizontal = Math.abs(a[1] - b[1]) < 1e-5;
        if (horizontal) {
          const tier = (a[1] - GROUND_Y) / LEVEL_HEIGHT;
          expect(tier).toBeCloseTo(Math.round(tier), 5);
          continue;
        }
        expect(a[0]).toBeCloseTo(b[0], 5);
        expect(a[2]).toBeCloseTo(b[2], 5);
        const vx = Math.round(a[0] / CELL_SIZE + map.width / 2);
        const vz = Math.round(a[2] / CELL_SIZE + map.depth / 2);
        const coastal = [-1, 0].some((dx) => [-1, 0].some((dz) => terrainOn(map, vx + dx, vz + dz) === 'water'));
        expect(coastal).toBe(true);
      }
    } finally {
      disposeModel(cliffs);
    }
  }
});

test('cliffs are seeded, finite, batched and leave the island unchanged', () => {
  for (const seed of [1, 2, 8, 37]) {
    const map = generateIsland(seed);
    const before = structuredClone(map);
    const cliffs = buildCliffs(map);
    const repeated = buildCliffs(map);
    const varied = buildCliffs({ ...map, seed: seed + 1 });
    try {
      expect(vertices(cliffs)).toEqual(vertices(repeated));
      expect(vertices(cliffs)).not.toEqual(vertices(varied));
      expect(map).toEqual(before);
      expect(cliffs.children).toHaveLength(1);
      expect(vertices(cliffs).length / 9).toBeLessThan(12000);
      const mesh = cliffs.children[0] as T.Mesh;
      expect(mesh.material).toBe(material(colors.stone));
      for (const value of vertices(cliffs)) expect(Number.isFinite(value)).toBe(true);
      const normals = mesh.geometry.attributes.normal;
      for (let index = 0; index < normals.count; index++) {
        expect(Math.hypot(normals.getX(index), normals.getY(index), normals.getZ(index))).toBeCloseTo(1, 5);
      }
      let geometriesDisposed = 0;
      let materialsDisposed = 0;
      const onMaterialDisposed = () => { materialsDisposed++; };
      mesh.geometry.addEventListener('dispose', () => { geometriesDisposed++; });
      material(colors.stone).addEventListener('dispose', onMaterialDisposed);
      disposeModel(cliffs);
      material(colors.stone).removeEventListener('dispose', onMaterialDisposed);
      expect(geometriesDisposed).toBe(1);
      expect(materialsDisposed).toBe(0);
    } finally {
      disposeModel(repeated);
      disposeModel(varied);
    }
  }
});

test('outcrops stay grounded inside one tile at every rotation', () => {
  const rock = cliffOutcrop();
  bake(rock);
  try {
    expect(rock.children).toHaveLength(1);
    for (let turn = 0; turn < 32; turn++) {
      rock.rotation.y = turn / 32 * Math.PI * 2;
      const bounds = new T.Box3().setFromObject(rock);
      expect(bounds.min.y).toBeLessThan(0);
      expect(bounds.max.y).toBeGreaterThan(.3);
      for (const axis of ['x', 'z'] as const) {
        expect(bounds.min[axis]).toBeGreaterThan(-CELL_SIZE / 2);
        expect(bounds.max[axis]).toBeLessThan(CELL_SIZE / 2);
      }
    }
  } finally {
    disposeModel(rock);
  }
});
