import { expect, test } from 'bun:test';
import * as T from 'three';
import { CityScene } from './city';
import type { Stage } from './stage';
import { islandFor, landingRoads } from '../sim/island';
import { build, createWorld, placement, recomputeConnectivity } from '../sim/world';
import { primaryCity } from '../sim/city';
import { freshHarbour } from '../sim/harbour';
import { STARTING_MONEY } from '../sim/catalog';
import type { City, World } from '../sim/types';

function foundSecondCity(world: World, home: number): City {
  const map = islandFor(world.seed, home);
  const city: City = {
    id: world.nextId++,
    home: map.home,
    founded: true,
    money: STARTING_MONEY,
    harbour: { ...freshHarbour(world.seed, landingRoads(map), map.home), id: world.nextId++ },
    produced: 0,
    delivered: 0,
    roads: landingRoads(map),
    buildings: [],
    walkers: [],
  };
  world.cities.push(city);
  recomputeConnectivity(world, city);
  return city;
}

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
  return { city, world, model };
}

test('a second founded city renders its own harbour and roads without hiding the first city', () => {
  const { city, world, model } = fixture();
  try {
    const city1 = primaryCity(world);
    const city2 = foundSecondCity(world, (city1.home + 1) % 8);
    city.sync(world);
    expect(model(city1.harbour.id)).toBeDefined();
    expect(model(city2.harbour.id)).toBeDefined();
    const roadTilesRendered = new Set(world.cities.flatMap((candidate) => candidate.roads));
    expect(roadTilesRendered.size).toBeGreaterThan(city1.roads.length);
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

test('an unfounded (pending) second city keeps its prepared landing road visible but has no harbour model', () => {
  const { city, world, model } = fixture();
  try {
    const city1 = primaryCity(world);
    const otherHome = (city1.home + 1) % 8;
    const map = islandFor(world.seed, otherHome);
    const pending: City = {
      id: world.nextId++,
      home: map.home,
      founded: false,
      money: STARTING_MONEY,
      harbour: { ...freshHarbour(world.seed, landingRoads(map), map.home), id: world.nextId++ },
      produced: 0,
      delivered: 0,
      roads: landingRoads(map),
      buildings: [],
      walkers: [],
    };
    world.cities.push(pending);
    city.sync(world);
    expect(model(pending.harbour.id)).toBeUndefined();
    const roadTilesRendered = new Set(world.cities.flatMap((candidate) => candidate.roads));
    for (const tile of pending.roads) expect(roadTilesRendered.has(tile)).toBe(true);
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
