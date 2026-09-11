import { expect, test } from 'bun:test';
import * as T from 'three';
import { generateIsland, groundHeight, terrainOn, worldPositionOn, type IslandMap } from '../sim/island';
import { disposeModel } from '../art/primitives';
import { buildTerrain } from './terrain';

for (const seed of [1, 2, 8, 37]) {
  test(`seed ${seed}: land tiles keep complete flat footprints beside coasts and cliffs`, () => {
    const map = generateIsland(seed);
    const before = structuredClone(map);
    const terrain = buildTerrain(map);
    const ray = new T.Raycaster();
    terrain.updateMatrixWorld(true);
    try {
      for (let z = 0; z < map.depth; z++) {
        for (let x = 0; x < map.width; x++) {
          if (terrainOn(map, x, z) === 'water') continue;
          for (const [dx, dz] of [[.001, .001], [.999, .001], [.999, .999], [.001, .999], [.5, .5]]) {
            const point = worldPositionOn(map, x + dx, z + dz);
            ray.set(new T.Vector3(point.x, 10, point.z), new T.Vector3(0, -1, 0));
            const hit = ray.intersectObject(terrain, true)[0];
            expect(hit).toBeDefined();
            expect(hit.point.y).toBeCloseTo(groundHeight(map, x, z), 5);
          }
        }
      }
      expect(map).toEqual(before);
    } finally {
      disposeModel(terrain);
    }
  }, 30_000);
}

function openEdges(model: T.Group): [T.Vector3, T.Vector3][] {
  const edges = new Map<string, { pair: [T.Vector3, T.Vector3]; count: number }>();
  function add(a: T.Vector3, b: T.Vector3): void {
    const key = [a, b].map((p) => p.toArray().map((v) => v.toFixed(5)).join(',')).sort().join(':');
    const edge = edges.get(key);
    if (edge) edge.count++;
    else edges.set(key, { pair: [a, b], count: 1 });
  }
  model.traverse((child) => {
    if (!(child instanceof T.Mesh)) return;
    const positions = child.geometry.attributes.position;
    for (let index = 0; index < positions.count; index += 3) {
      const points = [0, 1, 2].map((offset) => new T.Vector3().fromBufferAttribute(positions, index + offset));
      for (let side = 0; side < 3; side++) add(points[side], points[(side + 1) % 3]);
    }
  });
  expect([...edges.values()].every((edge) => edge.count <= 2)).toBe(true);
  const boundary = [...edges.values()].filter((edge) => edge.count === 1).map((edge) => edge.pair);
  const vertices = boundary.flat();
  edges.clear();
  for (const [a, b] of boundary) {
    const length = a.distanceTo(b);
    const cuts = vertices.filter((point) => Math.abs(a.distanceTo(point) + point.distanceTo(b) - length) < 1e-6);
    cuts.sort((p, q) => a.distanceToSquared(p) - a.distanceToSquared(q));
    for (let index = 0; index < cuts.length - 1; index++) {
      if (cuts[index].distanceToSquared(cuts[index + 1]) > 1e-12) add(cuts[index], cuts[index + 1]);
    }
  }
  expect([...edges.values()].every((edge) => edge.count <= 2)).toBe(true);
  return [...edges.values()].filter((edge) => edge.count === 1).map((edge) => edge.pair);
}

test('all mixed coastal terrace corners are closed above the waterline', () => {
  for (let mask = 0; mask < 256; mask++) {
    const map: IslandMap = {
      seed: 17,
      width: 4,
      depth: 4,
      terrain: Array.from({ length: 16 }, () => 'water'),
      level: new Uint8Array(16),
      entry: { x: 1, z: 1 },
    };
    for (let corner = 0; corner < 4; corner++) {
      const value = (mask >> (corner * 2)) & 3;
      if (!value) continue;
      const index = (Math.floor(corner / 2) + 1) * 4 + corner % 2 + 1;
      map.terrain[index] = 'cliff';
      map.level[index] = value - 1;
    }
    const terrain = buildTerrain(map);
    try {
      for (const edge of openEdges(terrain)) {
        for (const point of edge) expect(point.y, `mask ${mask}: ${edge.map((p) => p.toArray()).join(' / ')}`).toBeCloseTo(-.06, 5);
      }
    } finally {
      disposeModel(terrain);
    }
  }
});
