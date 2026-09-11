import { expect, test } from 'bun:test';
import * as T from 'three';
import { CELL_SIZE, GROUND_Y, generateIsland, type IslandMap } from '../sim/island';
import { buildCoast } from './coast';
import { colors, disposeModel, material } from './primitives';

function fixture(mask: number): IslandMap {
  return {
    seed: 17,
    width: 3,
    depth: 3,
    terrain: Array.from({ length: 9 }, (_, index) => mask & (1 << index) ? 'sand' : 'water'),
    level: new Uint8Array(9),
    entry: { x: 1, z: 1 },
  };
}

function vertices(model: T.Group): number[][] {
  return model.children.map((child) => Array.from((child as T.Mesh).geometry.attributes.position.array));
}

function boundaryEdges(model: T.Group): number[][][] {
  const edges = new Map<string, { points: number[][]; count: number }>();
  for (const positions of vertices(model)) {
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
  }
  expect([...edges.values()].every((edge) => edge.count <= 2)).toBe(true);
  return [...edges.values()].filter((edge) => edge.count === 1).map((edge) => edge.points);
}

test('all 3×3 shoreline masks join without cracks between the rim and waterline', () => {
  for (let mask = 0; mask < 512; mask++) {
    const coast = buildCoast(fixture(mask));
    try {
      for (const edge of boundaryEdges(coast)) {
        const rim = edge.every((point) => Math.abs(point[1] - GROUND_Y) < 1e-5);
        const waterline = edge.every((point) => Math.abs(point[1] + .06) < 1e-5);
        expect(rim || waterline).toBe(true);
      }
      for (const mesh of coast.children as T.Mesh[]) {
        for (const value of mesh.geometry.attributes.position.array) expect(Number.isFinite(value)).toBe(true);
        const normals = mesh.geometry.attributes.normal;
        for (let index = 0; index < normals.count; index++) {
          expect(Math.hypot(normals.getX(index), normals.getY(index), normals.getZ(index))).toBeCloseTo(1, 5);
        }
      }
    } finally {
      disposeModel(coast);
    }
  }
});

test('coasts are seeded, repeatable, and never mutate the logical island', () => {
  for (const seed of [1, 2, 8, 37]) {
    const map = generateIsland(seed);
    const before = structuredClone(map);
    const coast = buildCoast(map);
    const repeated = buildCoast(map);
    const varied = buildCoast({ ...map, seed: seed + 1 });
    try {
      expect(vertices(coast)).toEqual(vertices(repeated));
      expect(vertices(coast)).not.toEqual(vertices(varied));
      expect(map).toEqual(before);
      expect(coast.children).toHaveLength(2);
      expect(vertices(coast).reduce((count, positions) => count + positions.length / 9, 0)).toBeLessThan(12000);
    } finally {
      for (const model of [coast, repeated, varied]) disposeModel(model);
    }
  }
});

test('shallows stay at sea level and leave room in a one-cell channel', () => {
  const map = fixture(0b101101101);
  const coast = buildCoast(map);
  try {
    const shelf = coast.children[1] as T.Mesh;
    const positions = shelf.geometry.attributes.position;
    for (let index = 0; index < positions.count; index++) expect(positions.getY(index)).toBeCloseTo(-.06, 5);
    const ray = new T.Raycaster(new T.Vector3(0, 10, 0), new T.Vector3(0, -1, 0));
    expect(ray.intersectObject(coast, true)).toHaveLength(0);
    const bounds = new T.Box3().setFromObject(coast);
    expect(bounds.min.x).toBeGreaterThan(-2 * CELL_SIZE);
    expect(bounds.max.x).toBeLessThan(2 * CELL_SIZE);
  } finally {
    disposeModel(coast);
  }
});

test('coastal geometry is owned but the palette materials are shared', () => {
  const coast = buildCoast(fixture(16));
  let geometriesDisposed = 0;
  let materialsDisposed = 0;
  const onMaterialDisposed = () => { materialsDisposed++; };
  for (const mesh of coast.children as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>[]) {
    mesh.geometry.addEventListener('dispose', () => { geometriesDisposed++; });
    mesh.material.addEventListener('dispose', onMaterialDisposed);
  }
  expect((coast.children[0] as T.Mesh).material).toBe(material(colors.stone));
  disposeModel(coast);
  expect(geometriesDisposed).toBe(2);
  expect(materialsDisposed).toBe(0);
  for (const mesh of coast.children as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>[]) mesh.material.removeEventListener('dispose', onMaterialDisposed);
});
