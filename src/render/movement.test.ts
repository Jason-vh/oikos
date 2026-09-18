import { expect, test } from 'bun:test';
import * as T from 'three';
import { CityScene } from './city';
import type { Stage } from './stage';
import { islandFor } from '../sim/island';
import { createWorld } from '../sim/world';
import { primaryCity } from '../sim/city';
import { roadSpur } from '../sim/testing';
import { mapOf } from '../sim/grid';
import { CELL_SIZE, tileAtOn, tileIndexOn, worldPositionOn } from '../sim/island';
import { walkerSpeed } from '../sim/balance';
import { walkerPace } from '../sim/variation';
import type { Walker } from '../sim/types';

function fixture() {
  const world = createWorld();
  const stage = { scene: new T.Scene(), shadows() {}, invalidate() {}, world(_span: number) {} } as Stage;
  const city = new CityScene(stage, islandFor(world.seed), true);
  const owner = primaryCity(world);
  const walker: Walker = {
    id: world.nextId++,
    kind: 'porter',
    homeId: owner.harbour.id,
    targetId: null,
    path: roadSpur(world, 5).map((tile) => tileIndexOn(mapOf(world, owner), tile.x, tile.z)),
    departedAt: 0,
    step: 0,
    progress: 0,
    food: null,
    cargo: 0,
    returning: false,
    overland: [],
    quarry: null,
    task: null,
  };
  owner.walkers.push(walker);
  city.setWorldTime(0);
  city.sync(world);
  return { city, world, walker, at: () => city.moverPoint(walker.id)!.clone() };
}

test('a walker stands where the world clock puts it, not where a tween left it', () => {
  const { city, at, walker } = fixture();
  const pace = walkerPace(walker);
  city.setWorldTime(1 / pace);
  city.animate(0, 1 / 60, 1);
  const first = at();
  city.setWorldTime(2 / pace);
  city.animate(0, 1 / 60, 1);
  const second = at();
  expect(second.distanceTo(first)).toBeGreaterThan(0);
  city.setWorldTime(3 / pace);
  city.animate(0, 1 / 60, 1);
  expect(at().distanceTo(second)).toBeCloseTo(second.distanceTo(first), 6);
});

test('a repeated sync at the same instant moves nothing', () => {
  const { city, world, at, walker } = fixture();
  city.setWorldTime(.5 / walkerPace(walker));
  city.animate(0, 1 / 60, 1);
  const placed = at();
  for (let repeat = 0; repeat < 3; repeat++) city.sync(world);
  expect(at().distanceTo(placed)).toBe(0);
});

test('a beat that never arrives costs the walker nothing', () => {
  const even = fixture();
  const skipped = fixture();
  for (let beat = 1; beat <= 4; beat++) {
    even.city.setWorldTime(beat * .25);
    even.city.animate(0, .25, 1);
  }
  skipped.city.setWorldTime(.5);
  skipped.city.animate(0, .5, 1);
  skipped.city.setWorldTime(1);
  skipped.city.animate(0, .5, 1);
  expect(skipped.at().distanceTo(even.at())).toBeCloseTo(0, 9);
});

test('an animal is drawn wherever the clock puts it, with no update to wait for', () => {
  const world = createWorld();
  const stage = { scene: new T.Scene(), shadows() {}, invalidate() {}, world(_span: number) {} } as Stage;
  const city = new CityScene(stage, islandFor(world.seed), true);
  const animal = world.wildlife.find((candidate) => candidate.kind === 'gull')!;
  city.setWorldTime(0);
  city.sync(world);
  const start = city.moverPoint(animal.id)!.clone();
  city.setWorldTime(4);
  city.animate(0, 1 / 60, 1);
  const later = city.moverPoint(animal.id)!.clone();
  expect(later.distanceTo(start)).toBeGreaterThan(0);
  city.setWorldTime(0);
  city.animate(0, 1 / 60, 1);
  expect(city.moverPoint(animal.id)!.distanceTo(start)).toBeCloseTo(0, 9);
  city.dispose();
});

test('nothing alive stirs while the world stands still, and does once it moves', () => {
  const world = createWorld();
  const stage = { scene: new T.Scene(), shadows() {}, invalidate() {}, world(_span: number) {} } as Stage;
  const city = new CityScene(stage, islandFor(world.seed), true);
  const gull = world.wildlife.find((animal) => animal.kind === 'gull')!;
  city.setWorldTime(12);
  city.sync(world);
  city.watch(city.moverPoint(gull.id)!.clone(), 80);
  city.animate(0, 1 / 60, 1);
  const held = drawn(stage.scene);
  expect(held.length).toBeGreaterThan(0);
  for (let frame = 1; frame <= 30; frame++) city.animate(frame / 60, 1 / 60, 1);
  expect(drawn(stage.scene)).toEqual(held);
  city.setWorldTime(12.4);
  city.animate(.6, 1 / 60, 1);
  expect(drawn(stage.scene)).not.toEqual(held);
  city.dispose();
});

function drawn(scene: T.Scene): number[] {
  const matrices: number[] = [];
  scene.getObjectByName('wildlife')!.traverse((object) => {
    const instanced = object as T.InstancedMesh;
    if (instanced.isInstancedMesh) matrices.push(...instanced.instanceMatrix.array);
  });
  return matrices;
}

test('a snapshot from further ahead than the clock does not drag a walker with it', () => {
  const { city, world, at } = fixture();
  city.setWorldTime(.2);
  city.animate(0, 1 / 60, 1);
  const drawn = at();
  world.time = 1.4;
  city.sync(world);
  expect(at().distanceTo(drawn)).toBe(0);
  city.animate(0, 1 / 60, 1);
  expect(at().distanceTo(drawn)).toBe(0);
});

test('an axe falls at the same moment on every screen, and stops when the task does', () => {
  const world = createWorld();
  const stage = { scene: new T.Scene(), shadows() {}, invalidate() {}, world(_span: number) {} } as Stage;
  const city = new CityScene(stage, islandFor(world.seed), true);
  const owner = primaryCity(world);
  const spur = roadSpur(world, 4).map((tile) => tileIndexOn(mapOf(world, owner), tile.x, tile.z));
  const cutter: Walker = {
    id: world.nextId++, kind: 'woodcutter', homeId: owner.harbour.id, targetId: null,
    path: spur, departedAt: 0, step: 0, progress: 0, food: null, cargo: 0, returning: false,
    overland: [], quarry: null, task: { kind: 'chop', since: 10, until: 14 },
  };
  owner.walkers.push(cutter);
  city.setWorldTime(11);
  city.sync(world);
  city.animate(0, 1 / 60, 1);
  const swinging = armAngles(stage.scene, cutter.id);
  city.setWorldTime(11);
  city.animate(99, 1 / 60, 1);
  expect(armAngles(stage.scene, cutter.id)).toEqual(swinging);
  city.setWorldTime(15);
  city.animate(0, 1 / 60, 1);
  expect(armAngles(stage.scene, cutter.id)).not.toEqual(swinging);
  city.dispose();
});

function armAngles(scene: T.Scene, id: number): number[] {
  const model = scene.children.find((child) => child.userData.walkerId === id)!;
  const angles: number[] = [];
  model.traverse((object) => angles.push(Number(object.rotation.x.toFixed(6))));
  return angles;
}

test('a walker kept waiting looks about, of its own accord', () => {
  const world = createWorld();
  const stage = { scene: new T.Scene(), shadows() {}, invalidate() {}, world(_span: number) {} } as Stage;
  const city = new CityScene(stage, islandFor(world.seed), true);
  const owner = primaryCity(world);
  const spur = roadSpur(world, 3).map((tile) => tileIndexOn(mapOf(world, owner), tile.x, tile.z));
  const idlers = [0, 1].map(() => {
    const walker: Walker = {
      id: world.nextId++, kind: 'porter', homeId: owner.harbour.id, targetId: null,
      path: spur, departedAt: -100, step: spur.length - 1, progress: 0, food: null, cargo: 0,
      returning: false, overland: [], quarry: null, task: null,
    };
    owner.walkers.push(walker);
    return walker;
  });
  city.setWorldTime(0);
  city.sync(world);
  const facing = () => idlers.map((walker) => {
    const model = stage.scene.children.find((child) => child.userData.walkerId === walker.id);
    return model ? Number(model.rotation.y.toFixed(4)) : 0;
  });
  for (let frame = 0; frame < 20; frame++) {
    city.setWorldTime(frame / 10);
    city.animate(0, 1 / 10, 1);
  }
  const settled = facing();
  for (let frame = 0; frame < 100; frame++) {
    city.setWorldTime(2 + frame / 10);
    city.animate(0, 1 / 10, 1);
  }
  const looked = facing();
  expect(looked).not.toEqual(settled);
  expect(looked[0]).not.toBe(looked[1]);
  city.dispose();
});

test('two people left standing together eventually turn to face one another', () => {
  const world = createWorld();
  const stage = { scene: new T.Scene(), shadows() {}, invalidate() {}, world(_span: number) {} } as Stage;
  const city = new CityScene(stage, islandFor(world.seed), true);
  const owner = primaryCity(world);
  const spur = roadSpur(world, 4).map((tile) => tileIndexOn(mapOf(world, owner), tile.x, tile.z));
  const pair = [spur.slice(0, 2), spur.slice(1, 3)].map((path) => {
    const walker: Walker = {
      id: world.nextId++, kind: 'porter', homeId: owner.harbour.id, targetId: null,
      path, departedAt: -100, step: path.length - 1, progress: 0, food: null, cargo: 0,
      returning: false, overland: [], quarry: null, task: null,
    };
    owner.walkers.push(walker);
    return walker;
  });
  city.setWorldTime(0);
  city.sync(world);
  const place = (walker: Walker) => city.moverPoint(walker.id)!;
  const facingEachOther = () => {
    const models = pair.map((walker) => stage.scene.children.find((child) => child.userData.walkerId === walker.id)!);
    return models.every((model, index) => {
      const towards = place(pair[1 - index]).clone().sub(place(pair[index]));
      const wanted = Math.atan2(towards.x, towards.z);
      const off = Math.abs(Math.atan2(Math.sin(model.rotation.y - wanted), Math.cos(model.rotation.y - wanted)));
      return off < .25;
    });
  };
  let met = false;
  for (let frame = 0; frame < 1000 && !met; frame++) {
    city.setWorldTime(frame / 10);
    city.animate(0, 1 / 10, 1);
    met = facingEachOther();
  }
  expect(met).toBe(true);
  city.dispose();
});

function corner(world: ReturnType<typeof createWorld>): Walker {
  const owner = primaryCity(world);
  const map = mapOf(world, owner);
  const spur = roadSpur(world, 3);
  const step = { x: spur[1].x - spur[0].x, z: spur[1].z - spur[0].z };
  const turn = { x: spur[1].x + step.z, z: spur[1].z + step.x };
  const tiles = [spur[0], spur[1], turn, { x: turn.x + step.z, z: turn.z + step.x }];
  return {
    id: world.nextId++,
    kind: 'porter',
    homeId: owner.harbour.id,
    targetId: null,
    path: tiles.map((tile) => tileIndexOn(map, tile.x, tile.z)),
    departedAt: 0,
    step: 0,
    progress: 0,
    food: null,
    cargo: 0,
    returning: false,
    overland: [],
    quarry: null,
    task: null,
  };
}

test('a walker rounds a corner instead of pivoting on the spot', () => {
  const world = createWorld();
  const stage = { scene: new T.Scene(), shadows() {}, invalidate() {}, world(_span: number) {} } as Stage;
  const city = new CityScene(stage, islandFor(world.seed), true);
  const walker = corner(world);
  primaryCity(world).walkers.push(walker);
  city.setWorldTime(0);
  city.sync(world);
  try {
    const track: T.Vector3[] = [];
    for (let travelled = 0; travelled <= 3; travelled += .05) {
      city.setWorldTime(travelled / walkerPace(walker));
      city.animate(0, 1 / 60, 1);
      track.push(city.moverPoint(walker.id)!.clone());
    }
    let sharpest = 0;
    for (let index = 2; index < track.length; index++) {
      const before = Math.atan2(track[index - 1].x - track[index - 2].x, track[index - 1].z - track[index - 2].z);
      const after = Math.atan2(track[index].x - track[index - 1].x, track[index].z - track[index - 1].z);
      sharpest = Math.max(sharpest, Math.abs(Math.atan2(Math.sin(after - before), Math.cos(after - before))));
    }
    expect(sharpest).toBeLessThan(Math.PI / 6);

    const middle = tileAtOn(islandFor(world.seed), walker.path[1]);
    const inside = worldPositionOn(islandFor(world.seed), middle.x + .5, middle.z + .5);
    const closest = track.reduce((best, point) => Math.min(best, Math.hypot(point.x - inside.x, point.z - inside.z)), Infinity);
    expect(closest).toBeGreaterThan(.1);
  } finally {
    city.dispose();
  }
});

test('close wildlife is placed every frame, not only on the animation beat', () => {
  const world = createWorld();
  const stage = { scene: new T.Scene(), shadows() {}, invalidate() {}, world(_span: number) {} } as Stage;
  const city = new CityScene(stage, islandFor(world.seed), true);
  const gull = world.wildlife.find((animal) => animal.kind === 'gull')!;
  try {
    city.setWorldTime(12);
    city.sync(world);
    city.watch(city.moverPoint(gull.id)!.clone(), 40);
    city.animate(0, 1 / 30, 1);
    const beat = city.moverPoint(gull.id)!.clone();
    city.setWorldTime(12 + 1 / 120);
    city.transitions(1 / 120);
    expect(city.moverPoint(gull.id)!.distanceTo(beat)).toBeGreaterThan(0);

    city.watch(city.moverPoint(gull.id)!.clone(), 1400);
    city.animate(0, 1 / 30, 1);
    const far = city.moverPoint(gull.id)!.clone();
    city.setWorldTime(12 + 2 / 120);
    city.transitions(1 / 120);
    expect(city.moverPoint(gull.id)!.distanceTo(far)).toBe(0);
  } finally {
    city.dispose();
  }
});

test('a laden carter is slower than an empty-handed one, and still arrives on its own clock', () => {
  expect(walkerSpeed('cart')).toBeLessThan(walkerSpeed('vendor'));
  expect(walkerSpeed('porter')).toBeLessThan(walkerSpeed('vendor'));

  const world = createWorld();
  const stage = { scene: new T.Scene(), shadows() {}, invalidate() {}, world(_span: number) {} } as Stage;
  const city = new CityScene(stage, islandFor(world.seed), true);
  const owner = primaryCity(world);
  const spur = roadSpur(world, 5).map((tile) => tileIndexOn(mapOf(world, owner), tile.x, tile.z));
  const walker: Walker = {
    id: world.nextId++, kind: 'cart', homeId: owner.harbour.id, targetId: null,
    path: spur, departedAt: 0, step: 0, progress: 0, food: null, cargo: 0,
    returning: false, overland: [], quarry: null, task: null,
  };
  owner.walkers.push(walker);
  city.setWorldTime(0);
  city.sync(world);
  try {
    const last = spur.length - 1;
    city.setWorldTime(last / walkerPace(walker));
    city.animate(0, 1 / 60, 1);
    const arrived = city.moverPoint(walker.id)!.clone();
    const end = tileAtOn(islandFor(world.seed), spur[last]);
    const centre = worldPositionOn(islandFor(world.seed), end.x + .5, end.z + .5);
    expect(Math.hypot(arrived.x - centre.x, arrived.z - centre.z)).toBeLessThan(.01);
  } finally {
    city.dispose();
  }
});

test('a walker eases off a standstill rather than leaving at full speed', () => {
  const { city, at, walker } = fixture();
  const pace = walkerPace(walker);
  const sample = (tiles: number) => {
    city.setWorldTime(tiles / pace);
    city.animate(0, 1 / 60, 1);
    return at();
  };
  const start = sample(0);
  const opening = sample(.2).distanceTo(start);
  const settled = sample(2.2).distanceTo(sample(2));
  expect(opening).toBeLessThan(settled);
});

test('two walkers on one road do not stand in the same place', () => {
  const world = createWorld();
  const stage = { scene: new T.Scene(), shadows() {}, invalidate() {}, world(_span: number) {} } as Stage;
  const city = new CityScene(stage, islandFor(world.seed), true);
  const owner = primaryCity(world);
  const spur = roadSpur(world, 5).map((tile) => tileIndexOn(mapOf(world, owner), tile.x, tile.z));
  const pair = [0, 1].map(() => {
    const walker: Walker = {
      id: world.nextId++, kind: 'porter', homeId: owner.harbour.id, targetId: null,
      path: spur, departedAt: 0, step: 0, progress: 0, food: null, cargo: 0,
      returning: false, overland: [], quarry: null, task: null,
    };
    owner.walkers.push(walker);
    return walker;
  });
  city.setWorldTime(0);
  city.sync(world);
  try {
    city.setWorldTime(2 / walkerPace(pair[0]));
    city.animate(0, 1 / 60, 1);
    const [one, other] = pair.map((walker) => city.moverPoint(walker.id)!.clone());
    expect(one.distanceTo(other)).toBeGreaterThan(.15);
  } finally {
    city.dispose();
  }
});

test('a cart rolls forward on its wheels, by the ground it covers', () => {
  const world = createWorld();
  const stage = { scene: new T.Scene(), shadows() {}, invalidate() {}, world(_span: number) {} } as Stage;
  const city = new CityScene(stage, islandFor(world.seed), true);
  const owner = primaryCity(world);
  const spur = roadSpur(world, 5).map((tile) => tileIndexOn(mapOf(world, owner), tile.x, tile.z));
  const carter: Walker = {
    id: world.nextId++, kind: 'cart', homeId: owner.harbour.id, targetId: null,
    path: spur, departedAt: 0, step: 0, progress: 0, food: 'wheat', cargo: 40,
    returning: false, overland: [], quarry: null, task: null,
  };
  owner.walkers.push(carter);
  city.setWorldTime(0);
  city.sync(world);
  try {
    const model = stage.scene.children.find((child) => child.userData.walkerId === carter.id)!;
    const wheels = model.getObjectByName('cart')!.children.filter((part) => part.name === 'wheel');
    expect(wheels).toHaveLength(2);
    const turnAt = (tiles: number) => {
      city.setWorldTime(tiles / walkerPace(carter));
      city.animate(0, 1 / 60, 1);
      return wheels.map((wheel) => wheel.rotation.x);
    };
    const first = turnAt(1);
    const second = turnAt(2);
    expect(second[0]).toBeLessThan(first[0]);
    expect(second[0]).toBe(second[1]);
    const rolled = first[0] - second[0];
    expect(rolled).toBeCloseTo(CELL_SIZE / .19, 1);
  } finally {
    city.dispose();
  }
});
