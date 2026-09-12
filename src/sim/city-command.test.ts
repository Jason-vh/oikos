import { describe, expect, test } from 'bun:test';
import { build, createWorld, demolish, placement, placeRoadPath, setVendor } from './world';
import { applyCommand } from './commands';
import { primaryCity } from './city';
import { serializeWorld } from './save';
import { planStarterNeighbourhood, buildStarterNeighbourhood } from './scenario';
import { spotFor, freshRoadSpot, findTile } from './testing';
import { ISLAND_COUNT } from './island';
import type { City, World } from './types';

function secondCity(world: World, id: number): City {
  const primary = primaryCity(world);
  return structuredClone({ ...primary, id, roads: [], buildings: [], walkers: [] });
}

function spotForCity(world: World, city: City): { x: number; z: number } {
  return findTile(world, (_map, x, z) => placement(world, city, 'house', x, z, 0).ok)!;
}

describe('construction commands act only on the targeted City', () => {
  test('build, placeRoadPath and demolish leave every other City untouched', () => {
    const world = createWorld();
    const city1 = primaryCity(world);
    const city2 = secondCity(world, city1.id + 1);
    world.cities.push(city2);
    const snapshotCity2 = structuredClone(city2);

    const houseSpot = spotFor(world, 'house')!;
    expect(build(world, city1, 'house', houseSpot.x, houseSpot.z).ok).toBe(true);
    expect(city2).toEqual(snapshotCity2);

    const roadSpot = freshRoadSpot(world)!;
    expect(placeRoadPath(world, city1, [roadSpot]).ok).toBe(true);
    expect(city2).toEqual(snapshotCity2);

    expect(demolish(world, city1, houseSpot.x, houseSpot.z).ok).toBe(true);
    expect(city2).toEqual(snapshotCity2);

    const snapshotCity1 = structuredClone(city1);
    const city2Spot = spotForCity(world, city2);
    expect(build(world, city2, 'house', city2Spot.x, city2Spot.z).ok).toBe(true);
    expect(city1).toEqual(snapshotCity1);
  });

  test('mutations for any City draw from the single shared World.nextId allocator', () => {
    const world = createWorld();
    const city1 = primaryCity(world);
    const city2 = secondCity(world, city1.id + 1);
    world.cities.push(city2);

    const spot1 = spotFor(world, 'house')!;
    expect(build(world, city1, 'house', spot1.x, spot1.z).ok).toBe(true);
    const firstBuildingId = city1.buildings[0].id;

    const spot2 = spotForCity(world, city2);
    expect(build(world, city2, 'house', spot2.x, spot2.z).ok).toBe(true);
    const secondBuildingId = city2.buildings[0].id;

    expect(secondBuildingId).toBe(firstBuildingId + 1);
    expect(secondBuildingId).toBeLessThan(world.nextId);
  });

  test('setVendor only ever touches the given City\'s own buildings', () => {
    const world = createWorld();
    const city1 = primaryCity(world);
    const spot = spotFor(world, 'agora')!;
    expect(build(world, city1, 'agora', spot.x, spot.z).ok).toBe(true);
    const agora = city1.buildings[0];
    const city2 = secondCity(world, city1.id + 1);

    expect(setVendor(city2, agora.id, true).reason).toBe('No such building.');
    expect(agora.vendorInstalled).toBe(false);
    expect(setVendor(city1, agora.id, true).ok).toBe(true);
    expect(agora.vendorInstalled).toBe(true);
  });
});

describe('scenario helpers act on the given City, not the primary one', () => {
  test('plan and build a starter neighbourhood for another home island without touching the primary city', () => {
    const world = createWorld(1, 0);
    const city1 = primaryCity(world);
    const snapshotCity1 = structuredClone(city1);
    const otherHome = (city1.home + 1) % ISLAND_COUNT;
    const other = createWorld(1, otherHome);
    const city2: City = { ...primaryCity(other), id: city1.id + 1 };
    world.cities.push(city2);

    const beforePlanning = serializeWorld(world);
    const plan = planStarterNeighbourhood(world, city2);
    expect(plan).not.toBeNull();
    expect(serializeWorld(world)).toBe(beforePlanning);

    expect(buildStarterNeighbourhood(world, city2).ok).toBe(true);
    expect(city2.home).toBe(otherHome);
    expect(city2.buildings.length).toBeGreaterThan(0);
    expect(city1).toEqual(snapshotCity1);
  });
});

describe('applyCommand resolves the target City from the canonical World', () => {
  test('rejects an unknown city id atomically, without mutating anything', () => {
    const world = createWorld();
    const before = serializeWorld(world);
    const result = applyCommand(world, primaryCity(world).id + 999, { type: 'build', tool: 'house', x: 2, z: 3, rotation: 0 });
    expect(result).toEqual({ ok: false, reason: 'No such city.' });
    expect(serializeWorld(world)).toBe(before);
  });

  test('routes a well-formed command to the City matching the given id, not the first city positionally', () => {
    const world = createWorld();
    const city1 = primaryCity(world);
    const city2 = secondCity(world, city1.id + 1);
    world.cities.unshift(city2);
    expect(world.cities[0]).toBe(city2);

    const spot = spotForCity(world, city1);
    const result = applyCommand(world, city1.id, { type: 'build', tool: 'house', x: spot.x, z: spot.z, rotation: 0 });
    expect(result.ok).toBe(true);
    expect(city1.buildings).toHaveLength(1);
    expect(city2.buildings).toHaveLength(0);
  });
});
