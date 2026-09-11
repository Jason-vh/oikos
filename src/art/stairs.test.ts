import { expect, test } from 'bun:test';
import * as T from 'three';
import { CELL_SIZE, GROUND_Y, LEVEL_HEIGHT, tileAtOn, worldPositionOn, type IslandMap } from '../sim/island';
import { roadHeight, stairLayout, STAIR_STEPS } from '../sim/stairs';
import { buildTerrain } from '../render/terrain';
import { IslandScenery } from '../render/island';
import { addRoadMark } from '../render/road-marks';
import { buildRoads } from './roads';
import { STAIR_WIDTH } from './stairs';
import { colors, disposeModel, material } from './primitives';

function fixture(dx: number, dz: number, base = 0): IslandMap {
  const map: IslandMap = { seed: 17, width: 5, depth: 5, terrain: Array(25).fill('grass'), level: new Uint8Array(25), entry: { x: 0, z: 4 } };
  for (let index = 0; index < 25; index++) {
    const { x, z } = tileAtOn(map, index);
    const along = (x - 2) * dx + (z - 2) * dz;
    map.level[index] = base + Number(along >= 0);
    if (along === 0) map.terrain[index] = 'cliff';
  }
  return map;
}

function geometry(model: T.Object3D): T.BufferGeometry[] {
  const result: T.BufferGeometry[] = [];
  model.traverse((child) => { if (child instanceof T.Mesh) result.push(child.geometry); });
  return result;
}

function vertices(model: T.Object3D): number[][] {
  return geometry(model).map((geometry) => Array.from(geometry.attributes.position.array));
}

function below(model: T.Object3D, height: number): number[][] {
  return vertices(model).map((positions) => {
    const result: number[] = [];
    for (let i = 0; i < positions.length; i += 9) {
      if ([1, 4, 7].every((offset) => positions[i + offset] < height - .001)) result.push(...positions.slice(i, i + 9));
    }
    return result;
  });
}

function down(model: T.Object3D, map: IslandMap, x: number, z: number): T.Intersection {
  const point = worldPositionOn(map, x, z);
  return new T.Raycaster(new T.Vector3(point.x, 10, point.z), new T.Vector3(0, -1, 0)).intersectObject(model, true)[0];
}

test('cliff cuts expose every tread, retain solid shoulders and leave the lower terrace intact', () => {
  for (const base of [0, 1]) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const map = fixture(dx, dz, base);
      const before = structuredClone(map);
      const roads = [12 - dx - dz * map.width, 12, 12 + dx + dz * map.width];
      const stairs = stairLayout(map, new Set(roads));
      const original = buildTerrain(map);
      const terrain = buildTerrain(map, stairs);
      const model = new T.Group().add(terrain, buildRoads(map, roads));
      model.updateMatrixWorld(true);
      try {
        expect(stairs.size).toBe(1);
        expect(map).toEqual(before);
        expect(below(terrain, GROUND_Y + base * LEVEL_HEIGHT)).toEqual(below(original, GROUND_Y + base * LEVEL_HEIGHT));
        for (let step = 0; step < STAIR_STEPS; step++) {
          const along = (step + .5) / STAIR_STEPS - .5;
          const x = 2.5 + dx * along;
          const z = 2.5 + dz * along;
          for (const across of [-.3, 0, .3]) {
            const tread = down(model, map, x - dz * across, z + dx * across);
            expect(tread.point.y).toBeCloseTo(roadHeight(map, stairs, x, z) + .015, 4);
            expect((tread.object as T.Mesh).material).toBe(material(colors.paving));
          }
          for (const side of [-1, 1]) {
            const across = side * (STAIR_WIDTH / 2 + .04) / CELL_SIZE;
            expect(down(model, map, x - dz * across, z + dx * across).point.y).toBeCloseTo(GROUND_Y + (base + 1) * LEVEL_HEIGHT, 4);
          }
        }
        for (const along of [-1.1, -.8, -.51]) {
          expect(down(model, map, 2.5 + dx * along, 2.5 + dz * along).point.y).toBeLessThan(GROUND_Y + base * LEVEL_HEIGHT + .06);
        }
        const point = worldPositionOn(map, 2.5 - dx * .25, 2.5 - dz * .25);
        for (const side of [-1, 1]) {
          const ray = new T.Raycaster(new T.Vector3(point.x, GROUND_Y + (base + 1) * LEVEL_HEIGHT - .1, point.z), new T.Vector3(-dz * side, 0, dx * side));
          expect(ray.intersectObject(model, true)[0].distance).toBeCloseTo(STAIR_WIDTH / 2, 4);
        }
      } finally {
        disposeModel(original);
        disposeModel(model);
      }
    }
  }
});

test('terrain is rebuilt only for changed stair cuts and demolition restores the exact geometry', () => {
  const map = fixture(1, 0);
  const scene = new T.Scene();
  const scenery = new IslandScenery(scene, map);
  const original = vertices(scenery.terrain);
  const old = geometry(scenery.terrain);
  let disposed = 0;
  for (const geometry of old) geometry.addEventListener('dispose', () => disposed++);
  const stairs = stairLayout(map, new Set([11, 12, 13]));
  try {
    scenery.setStairs(stairs);
    expect(disposed).toBe(old.length);
    expect(vertices(scenery.terrain)).not.toEqual(original);
    const carved = geometry(scenery.terrain);
    scenery.setStairs(stairLayout(map, new Set([13, 12, 11, 0])));
    expect(geometry(scenery.terrain)).toEqual(carved);
    scenery.setStairs(new Map());
    expect(vertices(scenery.terrain)).toEqual(original);
    expect(disposed).toBe(old.length);
  } finally {
    scenery.dispose();
  }
});

test('placement and route markers follow all eight treads inside the reserved cell', () => {
  const plane = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  try {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const map = fixture(dx, dz);
      const stairs = stairLayout(map, new Set([12 - dx - dz * map.width, 12]));
      const root = new T.Group();
      addRoadMark(root, map, stairs, 12, plane, material(colors.blue), .06);
      expect(root.children.length).toBe(STAIR_STEPS);
      for (const mark of root.children) {
        const x = mark.position.x / CELL_SIZE + map.width / 2;
        const z = mark.position.z / CELL_SIZE + map.depth / 2;
        expect(Math.floor(x)).toBe(2);
        expect(Math.floor(z)).toBe(2);
        expect(mark.position.y).toBeCloseTo(roadHeight(map, stairs, x, z) + .09, 5);
      }
    }
  } finally {
    plane.dispose();
  }
});
