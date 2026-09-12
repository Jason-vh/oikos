import { describe, expect, test } from 'bun:test';
import { advance, build, createWorld, getSummary, hasActiveWalker, placement } from './world';
import { entryTileIndex, mapOf } from './grid';
import { primaryCity } from './city';
import { buildStarterNeighbourhood } from './scenario';
import { freshRoadSpot, spotFor } from './testing';
import { ISLAND_COUNT } from './island';
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

  test('placement checks the given City\'s money and roads, not the primary city implicitly', () => {
    const world = createWorld();
    const primary = primaryCity(world);
    const spot = freshRoadSpot(world)!;
    const poorCity: City = { ...primary, money: 0 };

    expect(placement(world, primary, 'road', spot.x, spot.z).ok).toBe(true);
    const poorResult = placement(world, poorCity, 'road', spot.x, spot.z);
    expect(poorResult.ok).toBe(false);
    expect(poorResult.reason).toBe('Not enough drachmas.');
  });

  test('getSummary counts only the given City\'s own buildings', () => {
    const world = createWorld();
    const farmSpot = spotFor(world, 'farm')!;
    expect(build(world, 'farm', farmSpot.x, farmSpot.z).ok).toBe(true);
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
