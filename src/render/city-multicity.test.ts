import { expect, test } from 'bun:test';
import * as T from 'three';
import { CityScene } from './city';
import type { Stage } from './stage';
import { islandFor, tileAtOn, worldPositionOn } from '../sim/island';
import { build, createWorld, placement } from '../sim/world';
import { primaryCity } from '../sim/city';
import { foundSecondCity } from '../sim/testing';
import type { City, World } from '../sim/types';

function spotFor(world: World, city: City, kind: 'house'): { x: number; z: number } {
  const map = islandFor(world.seed, city.home);
  const centre = map.entry;
  const reach = Math.max(map.width, map.depth);
  for (let radius = 0; radius <= reach; radius++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const x = centre.x + dx;
        const z = centre.z + dz;
        if (placement(world, city, kind, x, z, 0).ok) return { x, z };
      }
    }
  }
  throw new Error('no spot found');
}

function fixture() {
  const world = createWorld(1, 0);
  const scene = new T.Scene();
  const stage = { scene, shadows() {}, shadowsFromMotion() {}, invalidate() {} } as Stage;
  const city = new CityScene(stage, islandFor(world.seed), false);
  function model(id: number): T.Object3D | undefined {
    return scene.children.find((child) => child.userData.buildingId === id);
  }
  return { city, world, scene, model };
}

function roadTilePoint(world: World, city: City, tile: number): T.Vector3 {
  const map = islandFor(world.seed, city.home);
  const { x, z } = tileAtOn(map, tile);
  const point = worldPositionOn(map, x + .5, z + .5);
  return new T.Vector3(point.x, 0, point.z);
}

function roadsCover(scene: T.Scene, point: T.Vector3, tolerance = 2): boolean {
  const group = scene.getObjectByName('roads');
  if (!group) return false;
  const bounds = new T.Box3().setFromObject(group);
  return point.x >= bounds.min.x - tolerance && point.x <= bounds.max.x + tolerance
    && point.z >= bounds.min.z - tolerance && point.z <= bounds.max.z + tolerance;
}

test('a second founded city\'s road geometry is actually drawn, not just recorded on the World', () => {
  const { city, world, scene, model } = fixture();
  try {
    const city1 = primaryCity(world);
    const city2 = foundSecondCity(world, (city1.home + 1) % 8);
    city.sync(world);
    expect(model(city1.harbour.id)).toBeDefined();
    expect(model(city2.harbour.id)).toBeDefined();
    expect(roadsCover(scene, roadTilePoint(world, city1, city1.roads[city1.roads.length - 1]))).toBe(true);
    expect(roadsCover(scene, roadTilePoint(world, city2, city2.roads[city2.roads.length - 1]))).toBe(true);
  } finally {
    city.dispose();
  }
});

test('buildings from a second city appear and persist while the primary city is unaffected', () => {
  const { city, world, model } = fixture();
  try {
    const city1 = primaryCity(world);
    const city2 = foundSecondCity(world, (city1.home + 1) % 8);
    const spot = spotFor(world, city2, 'house');
    expect(build(world, city2, 'house', spot.x, spot.z, 0).ok).toBe(true);
    const house = city2.buildings[0];
    city.sync(world);
    expect(model(house.id)).toBeDefined();
    expect(city1.buildings.length).toBe(0);
    city.sync(world);
    expect(model(house.id)).toBeDefined();
  } finally {
    city.dispose();
  }
});

test('an unfounded (pending) second city has no harbour model but its prepared landing road is still drawn', () => {
  const { city, world, scene, model } = fixture();
  try {
    const city1 = primaryCity(world);
    const pending = foundSecondCity(world, (city1.home + 1) % 8, false);
    city.sync(world);
    expect(model(pending.harbour.id)).toBeUndefined();
    for (const tile of pending.roads) expect(roadsCover(scene, roadTilePoint(world, pending, tile))).toBe(true);
  } finally {
    city.dispose();
  }
});

test('a walker belonging to a second city is rendered, not just the first city\'s walkers', () => {
  const { city, world } = fixture();
  try {
    const city1 = primaryCity(world);
    const city2 = foundSecondCity(world, (city1.home + 1) % 8);
    city2.walkers.push({
      id: world.nextId++,
      kind: 'porter',
      homeId: city2.harbour.id,
      targetId: null,
      path: [city2.roads[0], city2.roads[0]],
      step: 0,
      progress: 0,
      food: null,
      cargo: 0,
      returning: false,
      overland: [],
      quarry: null,
      working: 0,
    });
    city.sync(world);
    expect(city.moverPoint(city2.walkers[0].id)).not.toBeNull();
  } finally {
    city.dispose();
  }
});
