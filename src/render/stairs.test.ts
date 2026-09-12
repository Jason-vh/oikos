import { expect, test } from 'bun:test';
import * as T from 'three';
import { CELL_SIZE, GROUND_Y, LEVEL_HEIGHT, soleIsland, tileAtOn, worldPositionOn } from '../sim/island';
import { STAIR_WIDTH } from '../art/stairs';
import { roadHeight, stairLayout } from '../sim/stairs';
import { createWorld } from '../sim/world';
import { primaryCity } from '../sim/city';
import type { Walker } from '../sim/types';
import { CityScene } from './city';
import type { Stage } from './stage';

function fixture(dx = 1, dz = 0) {
  const map = soleIsland({ seed: 17, width: 5, depth: 5, terrain: Array(25).fill('grass'), level: new Uint8Array(25), entry: { x: 0, z: 4 } });
  for (let index = 0; index < 25; index++) {
    const { x, z } = tileAtOn(map, index);
    const along = (x - 2) * dx + (z - 2) * dz;
    map.level[index] = Number(along >= 0);
    if (along === 0) map.terrain[index] = 'cliff';
  }
  const scene = new T.Scene();
  const camera = new T.OrthographicCamera(-4, 4, 4, -4, .1, 100);
  camera.position.set(-10, 11, 4);
  camera.lookAt(0, GROUND_Y + .8, 0);
  camera.updateMatrixWorld(true);
  const ray = new T.Raycaster();
  const renders = { shadows: 0 };
  const stage = {
    scene, camera,
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }) },
    shadows() { renders.shadows++; }, shadowsFromMotion() {}, invalidate() {},
    pick(x: number, y: number, height: number) {
      ray.setFromCamera(new T.Vector2(x / 400 - 1, 1 - y / 400), camera);
      return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -height), new T.Vector3());
    },
  } as unknown as Stage;
  const world = createWorld(map.seed);
  world.roads = [12 - dx - dz * map.width, 12, 12 + dx + dz * map.width];
  world.buildings = [];
  world.walkers = [];
  world.wildlife = [];
  const city = new CityScene(stage, map, false);
  city.sync(world);
  scene.updateMatrixWorld(true);
  return { city, map, world, scene, camera, renders, stairs: stairLayout(map, new Set(world.roads)) };
}

test('actual treads, risers and cut walls are pickable from every side', () => {
  let treads = 0;
  let verticalFaces = 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const { city, map, camera, stairs, scene } = fixture(dx, dz);
    const surfaces: T.Object3D[] = [city.scenery.terrain];
    scene.traverse((child) => { if (child.userData.stairs === true) surfaces.push(child); });
    const samples: T.Vector3[] = [];
    for (let step = 0; step < 8; step++) {
      const along = (step + .5) / 8 - .5;
      const x = 2.5 + dx * along;
      const z = 2.5 + dz * along;
      const top = worldPositionOn(map, x, z);
      samples.push(new T.Vector3(top.x, roadHeight(map, stairs, x, z) + .015, top.z));
      const front = worldPositionOn(map, 2.5 + dx * (step / 8 - .5), 2.5 + dz * (step / 8 - .5));
      samples.push(new T.Vector3(front.x, GROUND_Y + (step + .5) / 8 * LEVEL_HEIGHT + .015, front.z));
    }
    for (const side of [-1, 1]) {
      const point = worldPositionOn(map, 2.5 - dx * .3, 2.5 - dz * .3);
      samples.push(new T.Vector3(point.x - dz * side * STAIR_WIDTH / 2, GROUND_Y + LEVEL_HEIGHT - .2, point.z + dx * side * STAIR_WIDTH / 2));
    }
    try {
      for (let view = 0; view < 4; view++) {
        camera.position.set(-10, 11, 4).applyAxisAngle(new T.Vector3(0, 1, 0), view * Math.PI / 2);
        camera.lookAt(0, GROUND_Y + .8, 0);
        camera.updateMatrixWorld(true);
        for (const sample of samples) {
          const screen = sample.clone().project(camera);
          const ray = new T.Raycaster();
          ray.setFromCamera(new T.Vector2(screen.x, screen.y), camera);
          const hit = ray.intersectObjects(surfaces, true)[0];
          if (!hit?.object.userData.stairs) continue;
          expect(city.tileAtPointer((screen.x + 1) * 400, (1 - screen.y) * 400)).toEqual({ x: 2, z: 2 });
          if (Math.abs(hit.face!.normal.y) < .1) verticalFaces++;
          else treads++;
        }
      }
    } finally {
      city.dispose();
    }
  }
  expect(treads).toBeGreaterThan(32);
  expect(verticalFaces).toBeGreaterThan(16);
});

test('walkers follow the full-cell profile in both directions, including interpolated frames', () => {
  const { city, map, world, scene, stairs, renders } = fixture();
  const before = new Set(scene.children);
  const walker: Walker = { id: 9876, kind: 'immigrant', homeId: primaryCity(world).harbour.id, targetId: null, path: [11, 12, 13], step: 0, progress: 0, food: null, cargo: 0, returning: false, overland: [], quarry: null, working: 0 };
  world.walkers.push(walker);
  city.sync(world);
  const model = scene.children.find((child) => !before.has(child))!;
  expect(model).toBeDefined();
  try {
    for (const path of [[11, 12, 13], [13, 12, 11]]) {
      walker.path = path;
      for (let step = 0; step < 2; step++) {
        walker.step = step;
        for (let progress = 0; progress < 1; progress += .08) {
          walker.progress = progress;
          city.sync(world);
          for (const delta of [.1, .15]) {
            city.animate(0, delta, 1);
            const x = model.position.x / CELL_SIZE + map.width / 2;
            const z = model.position.z / CELL_SIZE + map.depth / 2;
            expect(model.position.y).toBeCloseTo(roadHeight(map, stairs, x, z) + .08, 5);
            for (const companion of model.children.slice(5)) {
              const point = companion.getWorldPosition(new T.Vector3());
              const height = roadHeight(map, stairs, point.x / CELL_SIZE + map.width / 2, point.z / CELL_SIZE + map.depth / 2);
              expect(point.y).toBeCloseTo(height + .08, 5);
            }
          }
        }
      }
    }
    walker.path = [11, 12, 13];
    walker.step = 1;
    walker.progress = .25;
    const shadows = renders.shadows;
    city.reload(world);
    expect(renders.shadows).toBeGreaterThan(shadows);
    expect(model.parent).toBeNull();
    const restored = scene.children.find((child) => !before.has(child))!;
    const point = worldPositionOn(map, 2.75, 2.5);
    expect(restored.position.x).toBeCloseTo(point.x, 5);
    expect(restored.position.y).toBeCloseTo(roadHeight(map, stairs, 2.75, 2.5) + .08, 5);
  } finally {
    city.dispose();
  }
});

test('every point over a terrace resolves to a tile, including across the step', () => {
  for (const [dx, dz] of [[1, 0], [0, 1]]) {
    const { city, map, camera, scene } = fixture(dx, dz);
    scene.updateMatrixWorld(true);
    const ray = new T.Raycaster();
    let sampled = 0;
    for (let sy = 40; sy < 760; sy += 20) {
      for (let sx = 40; sx < 760; sx += 20) {
        ray.setFromCamera(new T.Vector2(sx / 400 - 1, 1 - sy / 400), camera);
        const ground = ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -GROUND_Y), new T.Vector3());
        if (!ground) continue;
        const x = Math.floor(ground.x / CELL_SIZE + map.width / 2);
        const z = Math.floor(ground.z / CELL_SIZE + map.depth / 2);
        if (x < 1 || z < 1 || x >= map.width - 1 || z >= map.depth - 1) continue;
        sampled++;
        expect(city.tileAtPointer(sx, sy)).not.toBeNull();
      }
    }
    expect(sampled).toBeGreaterThan(20);
  }
});
