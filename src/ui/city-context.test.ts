import { describe, expect, test } from 'bun:test';
import { createWorld, recomputeConnectivity } from '../sim/world';
import { primaryCity } from '../sim/city';
import { freshHarbour } from '../sim/harbour';
import { islandFor, landingRoads, tileAtOn } from '../sim/island';
import { STARTING_MONEY } from '../sim/catalog';
import type { City, World } from '../sim/types';
import {
  activeCity,
  bootstrapCityContext,
  canWrite,
  resolveCity,
  returnToActive,
  submitCityCommand,
  viewedCity,
  withViewed,
} from './city-context';

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

function twoCityWorld() {
  const world = createWorld(1, 0);
  const city1 = primaryCity(world);
  const city2 = foundSecondCity(world, (city1.home + 1) % 8);
  return { world, city1, city2 };
}

describe('bootstrapCityContext', () => {
  test('a sole city becomes both viewed and active', () => {
    const world = createWorld();
    const context = bootstrapCityContext(world);
    expect(context.viewedId).toBe(world.cities[0].id);
    expect(context.activeId).toBe(world.cities[0].id);
    expect(canWrite(context)).toBe(true);
  });

  test('an empty world resolves to no city, safely', () => {
    const world = createWorld();
    world.cities = [];
    const context = bootstrapCityContext(world);
    expect(context.viewedId).toBeNull();
    expect(context.activeId).toBeNull();
    expect(canWrite(context)).toBe(false);
    expect(viewedCity(world, context)).toBeNull();
    expect(activeCity(world, context)).toBeNull();
  });
});

describe('resolving ids against the canonical world', () => {
  test('resolves a known city and rejects an unknown one', () => {
    const { world, city1 } = twoCityWorld();
    expect(resolveCity(world, city1.id)).toBe(city1);
    expect(resolveCity(world, city1.id + 999)).toBeNull();
    expect(resolveCity(world, null)).toBeNull();
  });

  test('viewing a second city never touches World.cities order or identity', () => {
    const { world, city1, city2 } = twoCityWorld();
    const before = [...world.cities];
    let context = bootstrapCityContext(world);
    context = withViewed(context, city2.id);
    expect(viewedCity(world, context)).toBe(city2);
    expect(activeCity(world, context)).toBe(city1);
    expect(world.cities).toEqual(before);
    expect(world.cities[0]).toBe(city1);
  });
});

describe('write guard', () => {
  test('viewing your own active city allows writes', () => {
    const context = { viewedId: 1, activeId: 1 };
    expect(canWrite(context)).toBe(true);
  });

  test('viewing a foreign city forbids writes even though an active city exists', () => {
    const context = { viewedId: 2, activeId: 1 };
    expect(canWrite(context)).toBe(false);
  });

  test('no active city forbids writes regardless of what is viewed', () => {
    expect(canWrite({ viewedId: null, activeId: null })).toBe(false);
    expect(canWrite({ viewedId: 1, activeId: null })).toBe(false);
  });

  test('returnToActive brings the view back home without touching the active city', () => {
    const context = withViewed({ viewedId: 1, activeId: 1 }, 2);
    const restored = returnToActive(context);
    expect(restored.viewedId).toBe(1);
    expect(restored.activeId).toBe(1);
  });
});

describe('submitCityCommand', () => {
  test('a command against the active city while viewing it mutates the world', () => {
    const { world, city1 } = twoCityWorld();
    const context = bootstrapCityContext(world);
    const roadCount = city1.roads.length;
    const map = islandFor(world.seed, city1.home);
    const tile = tileAtOn(map, city1.roads[city1.roads.length - 1]);
    const result = submitCityCommand(world, context, { type: 'demolish', x: tile.x, z: tile.z });
    expect(result.ok).toBe(true);
    expect(city1.roads.length).toBe(roadCount - 1);
  });

  test('the same command is refused, unmutated, while viewing a different city', () => {
    const { world, city1, city2 } = twoCityWorld();
    let context = bootstrapCityContext(world);
    context = withViewed(context, city2.id);
    const snapshot = structuredClone(world);
    const result = submitCityCommand(world, context, { type: 'vendor', id: city1.harbour.id, enabled: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Viewing another city grants no writes.');
    expect(world).toEqual(snapshot);
  });

  test('a command is refused, unmutated, when there is no active city at all', () => {
    const { world, city1 } = twoCityWorld();
    const context = { viewedId: null, activeId: null };
    const snapshot = structuredClone(world);
    const result = submitCityCommand(world, context, { type: 'vendor', id: city1.harbour.id, enabled: true });
    expect(result.ok).toBe(false);
    expect(world).toEqual(snapshot);
  });

  test('a command naming the viewed city directly is still refused, since it is not the active city', () => {
    const { world, city2 } = twoCityWorld();
    let context = bootstrapCityContext(world);
    context = withViewed(context, city2.id);
    const before = structuredClone(city2);
    submitCityCommand(world, context, { type: 'vendor', id: city2.harbour.id, enabled: true });
    expect(city2).toEqual(before);
  });
});
