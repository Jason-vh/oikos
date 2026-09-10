import { expect, test } from 'bun:test';
import * as T from 'three';
import { CityScene } from './city';
import type { Stage } from './stage';
import { islandFor } from '../sim/island';
import { build, createWorld, demolish } from '../sim/world';
import { planStarterNeighbourhood } from '../sim/scenario';

function fixture(motion = true) {
  const world = createWorld();
  const scene = new T.Scene();
  const stage = { scene, shadows() {}, invalidate() {} } as Stage;
  const city = new CityScene(stage, islandFor(world.seed), motion);
  const site = planStarterNeighbourhood(world)!.buildings.find((building) => building.kind === 'house')!;
  function placeHouse() {
    expect(build(world, 'house', site.x, site.z, 0).ok).toBe(true);
    city.sync(world);
    return world.buildings[0];
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
    house.vendorEnabled = true;
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
    expect(demolish(world, site.x, site.z).ok).toBe(true);
    city.sync(world);
    city.transitions(1);
    expect(previous.parent).toBeNull();
    expect(disposed).toBe(owned);
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
