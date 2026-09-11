import { expect, test } from 'bun:test';
import * as T from 'three';
import { CELL_SIZE, GROUND_Y, LEVEL_HEIGHT, generateIsland, tileAtOn, worldPositionOn, type IslandMap } from '../sim/island';
import { createWorld } from '../sim/world';
import { buildStarterNeighbourhood } from '../sim/scenario';
import { buildRoads } from './roads';
import { STAIR_STEPS as ROAD_STEPS } from '../sim/stairs';
import { colors, disposeModel, material } from './primitives';

function fixture(): IslandMap {
  return { seed: 17, width: 3, depth: 3, terrain: Array(9).fill('grass'), level: new Uint8Array(9), entry: { x: 1, z: 2 } };
}

function meshes(model: T.Group): T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>[] {
  return model.children as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>[];
}

function vertices(model: T.Group): number[][] {
  return meshes(model).map((mesh) => Array.from(mesh.geometry.attributes.position.array));
}

function hit(model: T.Group, x: number, z: number): T.Intersection | undefined {
  return new T.Raycaster(new T.Vector3(x, 10, z), new T.Vector3(0, -1, 0)).intersectObject(model, true)[0];
}

function atTile(model: T.Group, map: IslandMap, x: number, z: number): T.Intersection | undefined {
  const point = worldPositionOn(map, x, z);
  return hit(model, point.x, point.z);
}

function inRoad(map: IslandMap, roads: number[], x: number, z: number): boolean {
  return roads.some((index) => {
    const tile = tileAtOn(map, index);
    const origin = worldPositionOn(map, tile.x, tile.z);
    return x >= origin.x - 1e-5 && x <= origin.x + CELL_SIZE + 1e-5 && z >= origin.z - 1e-5 && z <= origin.z + CELL_SIZE + 1e-5;
  });
}

test('every flat neighbourhood keeps roads connected and empty tiles clear', () => {
  const map = fixture();
  for (let mask = 0; mask < 512; mask++) {
    const roads = Array.from({ length: 9 }, (_, i) => i).filter((index) => mask & (1 << index));
    const model = buildRoads(map, roads);
    model.updateMatrixWorld(true);
    try {
      expect(model.children.length).toBeLessThanOrEqual(3);
      for (let index = 0; index < 9; index++) {
        const { x, z } = tileAtOn(map, index);
        expect(Boolean(atTile(model, map, x + .5, z + .5))).toBe(roads.includes(index));
        if (!roads.includes(index)) continue;
        for (const [dx, dz] of [[1, 0], [0, 1]]) {
          if (x + dx >= map.width || z + dz >= map.depth || !roads.includes(index + dx + dz * map.width)) continue;
          for (const along of [.49, .5, .51]) expect(atTile(model, map, x + .5 + dx * along, z + .5 + dz * along)).toBeDefined();
        }
      }
      for (const mesh of meshes(model)) {
        const positions = mesh.geometry.attributes.position;
        const normals = mesh.geometry.attributes.normal;
        let valid = true;
        for (let i = 0; i < positions.count; i++) {
          valid &&= inRoad(map, roads, positions.getX(i), positions.getZ(i));
          valid &&= Number.isFinite(positions.getY(i));
          valid &&= Math.abs(normals.getY(i) - 1) < 1e-5;
        }
        expect(valid).toBe(true);
      }
    } finally {
      disposeModel(model);
    }
  }
});

test('ends and isolated tiles have inset edges and softened corners', () => {
  const map = fixture();
  const model = buildRoads(map, [4]);
  model.updateMatrixWorld(true);
  try {
    const bounds = new T.Box3().setFromObject(model);
    expect(bounds.min.x).toBeGreaterThan(-CELL_SIZE / 2);
    expect(bounds.max.x).toBeLessThan(CELL_SIZE / 2);
    for (const x of [1.04, 1.96]) {
      for (const z of [1.04, 1.96]) expect(atTile(model, map, x, z)).toBeUndefined();
    }
    for (const [x, z] of [[1.06, 1.5], [1.94, 1.5], [1.5, 1.06], [1.5, 1.94]]) expect(atTile(model, map, x, z)).toBeDefined();
  } finally {
    disposeModel(model);
  }
});

test('map-edge roads never connect to the next row by wrapping an index', () => {
  const map = fixture();
  const model = buildRoads(map, [2, 3]);
  model.updateMatrixWorld(true);
  try {
    expect(atTile(model, map, 2.99, .5)).toBeUndefined();
    expect(atTile(model, map, .01, 1.5)).toBeUndefined();
  } finally {
    disposeModel(model);
  }
});

test('paving courses continue over cell seams without a tile-sized joint', () => {
  const map = fixture();
  const model = buildRoads(map, [1, 3, 4, 5, 7]);
  model.updateMatrixWorld(true);
  try {
    for (const [dx, dz] of [[1, 0], [0, 1]]) {
      let flagsAcross = 0;
      for (let offset = -.4; offset <= .4; offset += .04) {
        const x = 1.5 + dx * .5 + dz * offset;
        const z = 1.5 + dz * .5 + dx * offset;
        const before = atTile(model, map, x - dx * .00001, z - dz * .00001)!;
        const after = atTile(model, map, x + dx * .00001, z + dz * .00001)!;
        expect(before.point.y).toBeCloseTo(after.point.y, 5);
        expect((before.object as T.Mesh).material).toBe((after.object as T.Mesh).material);
        if (before.point.y > GROUND_Y + .04) flagsAcross++;
      }
      expect(flagsAcross).toBeGreaterThan(12);
    }
  } finally {
    disposeModel(model);
  }
});

test('road art is seeded, insertion-order independent, and does not mutate its inputs', () => {
  for (const seed of [1, 2, 8, 37]) {
    const world = createWorld(seed);
    buildStarterNeighbourhood(world);
    const map = generateIsland(seed);
    const before = structuredClone({ map, world });
    const model = buildRoads(map, world.roads);
    const reversed = buildRoads(map, [...world.roads].reverse());
    const restored = buildRoads(map, JSON.parse(JSON.stringify(world.roads)));
    const varied = buildRoads({ ...map, seed: seed + 1 }, world.roads);
    try {
      expect(vertices(model)).toEqual(vertices(reversed));
      expect(vertices(model)).toEqual(vertices(restored));
      expect(vertices(model)).not.toEqual(vertices(varied));
      expect({ map, world }).toEqual(before);
      expect(model.children.length).toBeLessThanOrEqual(5);
      expect(vertices(model).reduce((sum, positions) => sum + positions.length / 9, 0)).toBeLessThan(world.roads.length * 180);
    } finally {
      for (const road of [model, reversed, restored, varied]) disposeModel(road);
    }
  }
});

test('distant construction and demolition leave existing flags unchanged', () => {
  const map = fixture();
  const model = buildRoads(map, [0]);
  const extended = buildRoads(map, [0, 8]);
  const restored = buildRoads(map, [0]);
  model.updateMatrixWorld(true);
  extended.updateMatrixWorld(true);
  try {
    expect(vertices(model)).toEqual(vertices(restored));
    for (let x = .15; x < .9; x += .1) {
      for (let z = .15; z < .9; z += .1) {
        const before = atTile(model, map, x, z)!;
        const after = atTile(extended, map, x, z)!;
        expect(before.point.y).toBe(after.point.y);
        expect((before.object as T.Mesh).material).toBe((after.object as T.Mesh).material);
      }
    }
  } finally {
    for (const road of [model, extended, restored]) disposeModel(road);
  }
});

test('stairs occupy the full upper cell and leave both neighbouring landings flat in every direction', () => {
  for (const baseLevel of [0, 1]) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const map: IslandMap = { ...fixture(), width: 5, depth: 5, terrain: Array(25).fill('grass'), level: new Uint8Array(25) };
      map.level.fill(baseLevel + 1);
      const lower = 12 - dx - dz * map.width;
      map.level[lower] = baseLevel;
      map.terrain[12] = 'cliff';
      const roads = [lower, 12, 12 + dx + dz * map.width];
      const model = buildRoads(map, roads);
      model.updateMatrixWorld(true);
      try {
        for (let step = 0; step < ROAD_STEPS; step++) {
          const along = (step + .5) / ROAD_STEPS - .5;
          const tread = atTile(model, map, 2.5 + dx * along, 2.5 + dz * along)!;
          expect(tread.point.y).toBeCloseTo(GROUND_Y + baseLevel * LEVEL_HEIGHT + (step + 1) / ROAD_STEPS * LEVEL_HEIGHT + .015, 4);
        }
        for (const distance of [.08, .2, .4]) {
          const foot = atTile(model, map, 2.5 - dx * (.5 + distance), 2.5 - dz * (.5 + distance))!;
          expect(foot.point.y).toBeGreaterThan(GROUND_Y + baseLevel * LEVEL_HEIGHT);
          expect(foot.point.y).toBeLessThan(GROUND_Y + baseLevel * LEVEL_HEIGHT + .06);
          expect(atTile(model, map, 2.5 + dx * (.5 + distance), 2.5 + dz * (.5 + distance))!.point.y).toBeGreaterThan(GROUND_Y + (baseLevel + 1) * LEVEL_HEIGHT);
        }
        expect(model.children.length).toBeLessThanOrEqual(5);
        for (const mesh of meshes(model)) {
          const positions = mesh.geometry.attributes.position;
          let inside = true;
          for (let i = 0; i < positions.count; i++) inside &&= inRoad(map, roads, positions.getX(i), positions.getZ(i));
          expect(inside).toBe(true);
        }
      } finally {
        disposeModel(model);
      }
    }
  }
});

test('branching climbs start beyond the flat junction rather than occupying its centre', () => {
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const roads = [2, 7, 10, 11, 12, 13, 14, 17, 22];
  for (let mask = 1; mask < 16; mask++) {
    const map: IslandMap = { ...fixture(), width: 5, depth: 5, terrain: Array(25).fill('grass'), level: new Uint8Array(25) };
    for (let side = 0; side < directions.length; side++) {
      if (!(mask & (1 << side))) continue;
      const [dx, dz] = directions[side];
      const upper = 12 + dx + dz * map.width;
      map.level[upper] = 1;
      map.terrain[upper] = 'cliff';
      map.level[upper + dx + dz * map.width] = 1;
    }
    const model = buildRoads(map, roads);
    model.updateMatrixWorld(true);
    try {
      expect(atTile(model, map, 2.5, 2.5)!.point.y).toBeLessThan(GROUND_Y + .06);
      for (let side = 0; side < directions.length; side++) {
        const [dx, dz] = directions[side];
        for (let step = 0; step < ROAD_STEPS; step++) {
          const along = .5 + (step + .5) / ROAD_STEPS;
          const tread = atTile(model, map, 2.5 + dx * along, 2.5 + dz * along)!;
          if (mask & (1 << side)) expect(tread.point.y).toBeCloseTo(GROUND_Y + (step + 1) / ROAD_STEPS * LEVEL_HEIGHT + .015, 4);
          else expect(tread.point.y).toBeLessThan(GROUND_Y + .06);
        }
      }
    } finally {
      disposeModel(model);
    }
  }
});

test('successive climbs meet at the shared boundary of their reserved cells', () => {
  const map: IslandMap = { ...fixture(), width: 5, terrain: Array(15).fill('grass'), level: new Uint8Array(15) };
  map.level[6] = 1;
  map.level[7] = 2;
  map.level[8] = 2;
  map.terrain[6] = 'cliff';
  map.terrain[7] = 'cliff';
  const model = buildRoads(map, [5, 6, 7, 8]);
  model.updateMatrixWorld(true);
  try {
    expect(atTile(model, map, 1.99, 1.5)!.point.y).toBeCloseTo(GROUND_Y + LEVEL_HEIGHT + .015, 4);
    for (let step = 0; step < ROAD_STEPS * 2; step++) {
      const along = (step + .5) / ROAD_STEPS;
      expect(atTile(model, map, 1 + along, 1.5)!.point.y).toBeCloseTo(GROUND_Y + (step + 1) / ROAD_STEPS * LEVEL_HEIGHT + .015, 4);
    }
  } finally {
    disposeModel(model);
  }
});

test('flat surfaces and baked stairs own geometry, share materials, and use the right shadows', () => {
  for (const climbing of [false, true]) {
    const map = fixture();
    if (climbing) {
      map.level.fill(1);
      map.level[3] = 0;
      map.terrain[4] = 'cliff';
    }
    const model = buildRoads(map, climbing ? [3, 4, 5] : [1, 3, 4, 5, 7]);
    const palette = [material(colors.paving), material(colors.stone), material(colors.cream)];
    let geometriesDisposed = 0;
    let materialsDisposed = 0;
    let casting = 0;
    const onMaterialDisposed = () => { materialsDisposed++; };
    for (const mesh of meshes(model)) {
      const normals = mesh.geometry.attributes.normal;
      let flat = true;
      for (let i = 0; i < normals.count; i++) flat &&= Math.abs(normals.getY(i) - 1) < 1e-5;
      expect(palette).toContain(mesh.material);
      expect(mesh.material.transparent).toBe(false);
      expect(mesh.castShadow).toBe(!flat);
      expect(mesh.receiveShadow).toBe(true);
      if (mesh.castShadow) casting++;
      mesh.geometry.addEventListener('dispose', () => { geometriesDisposed++; });
      mesh.material.addEventListener('dispose', onMaterialDisposed);
    }
    expect(casting).toBe(climbing ? 2 : 0);
    disposeModel(model);
    expect(geometriesDisposed).toBe(model.children.length);
    expect(materialsDisposed).toBe(0);
    for (const mesh of meshes(model)) mesh.material.removeEventListener('dispose', onMaterialDisposed);
  }
});
