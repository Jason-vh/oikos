import { describe, expect, test } from 'bun:test';
import { advance, build, createWorld, getSummary, hasActiveWalker, placement, roadPathPlacement } from './world';
import { entryTileIndex, mapOf } from './grid';
import { primaryCity } from './city';
import { buildStarterNeighbourhood } from './scenario';
import { freshRoadSpot, spotFor } from './testing';
import { ISLAND_COUNT, tileAtOn } from './island';
import { ROAD_COST } from './catalog';
import type { City } from './types';

describe('queries take an explicit City rather than defaulting to the primary one', () => {
  test('mapOf and entryTileIndex resolve the given City\'s home island, not primaryCity(world)\'s', () => {
    const world = createWorld(1, 0);
    const primary = primaryCity(world);
    const otherHome = (primary.home + 1) % ISLAND_COUNT;
    const otherCity: City = { ...primary, home: otherHome };

    const primaryMap = mapOf(world, primary);
    const otherMap = mapOf(world, otherCity);
    expect(otherMap.home).toBe(otherHome);
    expect(otherMap.entry).not.toEqual(primaryMap.entry);
    expect(entryTileIndex(world, otherCity)).not.toBe(entryTileIndex(world, primary));
  });

  test('placement checks the given City\'s money, not the primary city implicitly', () => {
    const world = createWorld();
    const primary = primaryCity(world);
    const spot = freshRoadSpot(world)!;
    const poorCity: City = { ...primary, money: 0 };

    expect(placement(world, primary, 'road', spot.x, spot.z).ok).toBe(true);
    const poorResult = placement(world, poorCity, 'road', spot.x, spot.z);
    expect(poorResult.ok).toBe(false);
    expect(poorResult.reason).toBe('Not enough drachmas.');
  });

  test('placement checks the given City\'s own roads, not the primary city\'s', () => {
    const world = createWorld();
    const primary = primaryCity(world);
    const existingRoad = primary.roads[0];
    const { x, z } = tileAtOn(mapOf(world, primary), existingRoad);

    const primaryResult = placement(world, primary, 'road', x, z);
    expect(primaryResult.ok).toBe(true);
    expect(primaryResult.cost).toBe(0);

    const roadlessCity: City = { ...primary, roads: [] };
    const roadlessResult = placement(world, roadlessCity, 'road', x, z);
    expect(roadlessResult.ok).toBe(true);
    expect(roadlessResult.cost).toBe(ROAD_COST);
  });

  test('placement and roadPathPlacement block on the given City\'s own harbour footprint, not the primary city\'s', () => {
    const world = createWorld();
    const primary = primaryCity(world);
    const houseSpot = spotFor(world, 'house')!;
    expect(placement(world, primary, 'house', houseSpot.x, houseSpot.z).ok).toBe(true);

    const otherCity: City = { ...primary, harbour: { ...primary.harbour, x: houseSpot.x, z: houseSpot.z } };
    const blockedHouse = placement(world, otherCity, 'house', houseSpot.x, houseSpot.z);
    expect(blockedHouse.ok).toBe(false);
    expect(blockedHouse.reason).toBe('That tile is occupied.');
    expect(placement(world, primary, 'house', houseSpot.x, houseSpot.z).ok).toBe(true);

    const roadSpot = freshRoadSpot(world, houseSpot)!;
    const otherHarbourAtRoad: City = { ...primary, harbour: { ...primary.harbour, x: roadSpot.x, z: roadSpot.z } };
    expect(roadPathPlacement(world, primary, [roadSpot]).ok).toBe(true);
    const blockedRoad = roadPathPlacement(world, otherHarbourAtRoad, [roadSpot]);
    expect(blockedRoad.ok).toBe(false);
    expect(roadPathPlacement(world, primary, [roadSpot]).ok).toBe(true);
  });

  test('getSummary counts only the given City\'s own buildings', () => {
    const world = createWorld();
    const farmSpot = spotFor(world, 'farm')!;
    expect(build(world, primaryCity(world), 'farm', farmSpot.x, farmSpot.z).ok).toBe(true);
    const primary = primaryCity(world);
    const emptyCity: City = { ...primary, buildings: [] };

    expect(getSummary(primary).jobs).toBeGreaterThan(0);
    expect(getSummary(emptyCity).jobs).toBe(0);
  });

  test('hasActiveWalker checks only the given City\'s own walkers', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world).ok).toBe(true);
    advance(world, 90);
    const primary = primaryCity(world);
    expect(primary.walkers.length).toBeGreaterThan(0);
    const activeWalker = primary.walkers[0];
    const emptyCity: City = { ...primary, walkers: [] };

    expect(hasActiveWalker(primary, activeWalker.homeId, activeWalker.kind)).toBe(true);
    expect(hasActiveWalker(emptyCity, activeWalker.homeId, activeWalker.kind)).toBe(false);
  });
});
