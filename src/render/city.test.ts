import { expect, test } from 'bun:test';
import * as T from 'three';
import { CityScene } from './city';
import type { Stage } from './stage';
import { islandFor } from '../sim/island';
import { advance, build, createWorld, demolish } from '../sim/world';
import { buildStarterNeighbourhood, planStarterNeighbourhood } from '../sim/scenario';
import { primaryCity } from '../sim/city';

function fixture(motion = true) {
  const world = createWorld();
  const scene = new T.Scene();
  const stage = { scene, shadows() {}, invalidate() {}, world(_span: number) {} } as Stage;
  const city = new CityScene(stage, islandFor(world.seed), motion);
  const site = planStarterNeighbourhood(world, primaryCity(world))!.buildings.find((building) => building.kind === 'house')!;
  function placeHouse() {
    expect(build(world, primaryCity(world), 'house', site.x, site.z, 0).ok).toBe(true);
    city.sync(world);
    return primaryCity(world).buildings[0];
  }
  function model(id: number): T.Object3D {
    return scene.children.find((child) => child.userData.buildingId === id)!;
  }
  return { city, world, placeHouse, model, site };
}

test('paused placement completes visually without advancing the simulation or replaying on sync', () => {
  const { city, world, placeHouse, model } = fixture();
  try {
    city.sync(world);
    const house = placeHouse();
    const state = JSON.stringify(world);
    expect(model(house.id).getObjectByName('roof')).toBeDefined();
    city.transitions(.8);
    const roofHeight = model(house.id).getObjectByName('roof')!.position.y;
    city.sync(world);
    expect(model(house.id).getObjectByName('roof')!.position.y).toBe(roofHeight);
    city.transitions(1);
    expect(model(house.id).getObjectByName('roof')).toBeUndefined();
    expect(city.transitions(.1)).toBe(false);
    city.sync(world);
    expect(city.transitions(.1)).toBe(false);
    expect(JSON.stringify(world)).toBe(state);
  } finally {
    city.dispose();
  }
});

test('state-key replacement preserves construction progress; tier changes remove it safely', () => {
  const { city, world, placeHouse, model } = fixture();
  try {
    city.sync(world);
    const house = placeHouse();
    city.transitions(.8);
    const previous = model(house.id);
    const roofHeight = previous.getObjectByName('roof')!.position.y;
    house.stalls = { food: { installed: true, enabled: true } };
    city.sync(world);
    expect(previous.parent).toBeNull();
    expect(model(house.id).getObjectByName('roof')!.position.y).toBe(roofHeight);
    house.tier = 2;
    city.sync(world);
    expect(model(house.id).getObjectByName('roof')).toBeUndefined();
    city.transitions(2);
    expect(model(house.id).scale.toArray()).toEqual([1, 1, 1]);
  } finally {
    city.dispose();
  }
});

test('demolition during assembly cleans up both models after the departure', () => {
  const { city, world, placeHouse, model, site } = fixture();
  try {
    city.sync(world);
    const house = placeHouse();
    city.transitions(.4);
    const previous = model(house.id);
    let owned = 0;
    let disposed = 0;
    previous.traverse((child) => {
      if (!(child instanceof T.Mesh)) return;
      owned++;
      child.geometry.addEventListener('dispose', () => { disposed++; });
    });
    expect(demolish(world, primaryCity(world), site.x, site.z).ok).toBe(true);
    city.sync(world);
    city.transitions(1);
    expect(previous.parent).toBeNull();
    expect(disposed).toBe(owned);
    expect(city.transitions(.1)).toBe(false);
  } finally {
    city.dispose();
  }
});

test('a restored checkpoint shows its buildings standing, never rebuilding them', () => {
  const { city, world, placeHouse, model } = fixture();
  try {
    city.sync(world);
    const checkpoint = structuredClone(world);
    const house = placeHouse();
    city.transitions(.4);
    expect(model(house.id).getObjectByName('roof')).toBeDefined();

    city.reload(checkpoint);
    expect(model(house.id)).toBeUndefined();
    expect(city.transitions(.1)).toBe(false);

    city.reload(world);
    expect(model(house.id).getObjectByName('roof')).toBeUndefined();
    expect(city.transitions(.1)).toBe(false);
  } finally {
    city.dispose();
  }
});

test('loaded buildings and reduced-motion placement appear complete', () => {
  const loaded = fixture();
  const reduced = fixture(false);
  try {
    const loadedHouse = loaded.placeHouse();
    expect(loaded.model(loadedHouse.id).getObjectByName('roof')).toBeUndefined();
    expect(loaded.city.transitions(.1)).toBe(false);
    reduced.city.sync(reduced.world);
    const reducedHouse = reduced.placeHouse();
    expect(reduced.model(reducedHouse.id).getObjectByName('roof')).toBeUndefined();
    expect(reduced.city.transitions(.1)).toBe(false);
  } finally {
    loaded.city.dispose();
    reduced.city.dispose();
  }
});

function glowingParts(model: T.Object3D): number {
  let count = 0;
  model.traverse((child) => {
    const mesh = child as T.Mesh;
    if (!mesh.isMesh) return;
    if ((mesh.material as T.MeshStandardMaterial).emissive.getHex() !== 0) count++;
  });
  return count;
}

test('only what the cursor or the inspector holds is ever lit', () => {
  const { city, world, placeHouse, model } = fixture(false);
  try {
    const house = placeHouse();
    const harbour = world.cities[0].harbour;
    const parts = glowingParts(model(house.id));
    expect(parts).toBe(0);

    city.emphasise({ kind: 'building', id: house.id });
    city.transitions(1);
    expect(glowingParts(model(house.id))).toBeGreaterThan(0);

    city.select(house, null);
    city.emphasise(null);
    city.transitions(1);
    expect(glowingParts(model(house.id))).toBeGreaterThan(0);
    expect(glowingParts(model(harbour.id))).toBe(0);

    city.select(null, null);
    city.transitions(1);
    expect(glowingParts(model(house.id))).toBe(0);

    city.emphasise({ kind: 'building', id: harbour.id });
    city.transitions(1);
    expect(glowingParts(model(house.id))).toBe(0);
    expect(glowingParts(model(harbour.id))).toBeGreaterThan(0);
  } finally {
    city.dispose();
  }
});

test('a walker grows into the street and shrinks away again, never popping', () => {
  const world = createWorld();
  expect(buildStarterNeighbourhood(world, primaryCity(world)).ok).toBe(true);
  const scene = new T.Scene();
  const stage = { scene, shadows() {}, invalidate() {}, world(_span: number) {} } as Stage;
  const city = new CityScene(stage, islandFor(world.seed), true);
  try {
    city.setWorldTime(world.time);
    city.sync(world);
    for (let elapsed = 0; elapsed < 2000 && primaryCity(world).walkers.length === 0; elapsed++) advance(world, 1);
    const walker = primaryCity(world).walkers[0];
    expect(walker).toBeDefined();
    city.setWorldTime(world.time);
    city.sync(world);

    const model = scene.children.find((child) => child.userData.walkerId === walker.id)!;
    expect(model).toBeDefined();
    expect(model.scale.x).toBeLessThan(.8);
    city.transitions(.5);
    expect(model.scale.x).toBeCloseTo(.83, 2);

    primaryCity(world).walkers = [];
    city.sync(world);
    city.transitions(.1);
    expect(model.parent).not.toBeNull();
    expect(model.scale.y).toBeLessThan(.83);
    city.transitions(.3);
    expect(model.parent).toBeNull();
  } finally {
    city.dispose();
  }
});

test('a reloaded city stands its walkers up without an entrance', () => {
  const world = createWorld();
  expect(buildStarterNeighbourhood(world, primaryCity(world)).ok).toBe(true);
  for (let elapsed = 0; elapsed < 2000 && primaryCity(world).walkers.length === 0; elapsed++) advance(world, 1);
  const scene = new T.Scene();
  const stage = { scene, shadows() {}, invalidate() {}, world(_span: number) {} } as Stage;
  const city = new CityScene(stage, islandFor(world.seed), true);
  try {
    city.setWorldTime(world.time);
    city.sync(world);
    const walker = primaryCity(world).walkers[0];
    const model = scene.children.find((child) => child.userData.walkerId === walker.id)!;
    expect(model.scale.x).toBeCloseTo(.83, 2);
  } finally {
    city.dispose();
  }
});

