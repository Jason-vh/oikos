import { describe, expect, test } from 'bun:test';
import * as T from 'three';
import { CityScene } from './city';
import type { Stage } from './stage';
import { groundHeight, islandFor, levelOn, terrainOn, tileAtOn, tileIndexOn, worldPositionOn, type IslandMap } from '../sim/island';
import { build, createWorld, placement } from '../sim/world';
import { primaryCity } from '../sim/city';
import { foundSecondCity } from '../sim/testing';
import type { City, Walker, World } from '../sim/types';

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
  const stage = { scene, shadows() {}, invalidate() {}, world(_span: number) {} } as Stage;
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
      departedAt: 0,
      step: 0,
      progress: 0,
      food: null,
      cargo: 0,
      returning: false,
      overland: [],
      quarry: null,
      task: null,
    });
    city.sync(world);
    expect(city.moverPoint(city2.walkers[0].id)).not.toBeNull();
  } finally {
    city.dispose();
  }
});

function stationaryWalkerHeight(city: CityScene, world: World, owner: City, tile: number): number {
  const walker: Walker = {
    id: world.nextId++,
    kind: 'porter',
    homeId: owner.harbour.id,
    targetId: null,
    path: [tile, tile],
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
  city.sync(world);
  return city.moverPoint(walker.id)!.y;
}

function cliffStep(map: IslandMap): { upper: number; flat: number; west: number; north: number } {
  const island = map.islands[map.home];
  for (let z = island.z + 1; z < island.z + island.depth; z++) {
    for (let x = island.x + 1; x < island.x + island.width - 1; x++) {
      const around = [[0, 0], [1, 0], [-1, 0], [0, -1]].map(([dx, dz]) => ({
        level: levelOn(map, x + dx, z + dz),
        terrain: terrainOn(map, x + dx, z + dz),
      }));
      const [upper, flat, west, north] = around;
      if (around.some((tile) => tile.terrain === 'water')) continue;
      if (upper.level !== 1 || flat.level !== 1 || west.level !== 0 || north.level !== 0) continue;
      return {
        upper: tileIndexOn(map, x, z),
        flat: tileIndexOn(map, x + 1, z),
        west: tileIndexOn(map, x - 1, z),
        north: tileIndexOn(map, x, z - 1),
      };
    }
  }
  throw new Error('no cliff step found');
}

describe('a city\'s road and stair geometry never depends on a neighbouring city\'s roads', () => {
  const step = cliffStep(islandFor(1, 0));
  const upperTile = tileAtOn(islandFor(1, 0), step.upper);

  test('a foreign road one level down does not turn the owner\'s flat cliff-top road into a stair', () => {
    const { city, world } = fixture();
    try {
      const city1 = primaryCity(world);
      city1.roads = [step.upper, step.flat];
      const city2 = foundSecondCity(world, (city1.home + 1) % 8);
      city2.roads = [step.west];

      const map = islandFor(world.seed);
      const flatHeight = groundHeight(map, upperTile.x, upperTile.z) + .08;
      expect(stationaryWalkerHeight(city, world, city1, step.upper)).toBeCloseTo(flatHeight, 5);
    } finally {
      city.dispose();
    }
  });

  test('an unrelated foreign road to the north does not erase the owner\'s own real stair', () => {
    const { city, world } = fixture();
    try {
      const city1 = primaryCity(world);
      city1.roads = [step.west, step.upper];
      const city2 = foundSecondCity(world, (city1.home + 1) % 8);
      city2.roads = [step.north];

      const map = islandFor(world.seed);
      const flatHeight = groundHeight(map, upperTile.x, upperTile.z) + .08;
      expect(stationaryWalkerHeight(city, world, city1, step.upper)).not.toBeCloseTo(flatHeight, 5);
    } finally {
      city.dispose();
    }
  });
});
