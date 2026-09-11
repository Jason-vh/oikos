import { expect, test } from 'bun:test';
import * as T from 'three';
import { buildable, generateIsland, groundHeight, terrainOn, worldPositionOn } from '../sim/island';
import { disposeModel } from '../art/primitives';
import { buildTerrain } from './terrain';

test('buildable coastal tiles keep their complete flat footprints, including corners', () => {
  for (const seed of [1, 2, 8, 37]) {
    const map = generateIsland(seed);
    const before = structuredClone(map);
    const terrain = buildTerrain(map);
    const ray = new T.Raycaster();
    terrain.updateMatrixWorld(true);
    try {
      for (let z = 0; z < map.depth; z++) {
        for (let x = 0; x < map.width; x++) {
          if (!buildable(terrainOn(map, x, z))) continue;
          const coastal = [-1, 0, 1].some((dx) => [-1, 0, 1].some((dz) => terrainOn(map, x + dx, z + dz) === 'water'));
          if (!coastal) continue;
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
  }
});
