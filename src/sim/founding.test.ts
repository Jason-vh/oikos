import { expect, test } from 'bun:test';
import { findHarbourSite, harbourApron, harbourLandTiles, harbourPlacement, harbourSite, HARBOUR_LAND_DEPTH, HARBOUR_WATER_DEPTH, HARBOUR_WIDTH } from './founding';
import { footprint } from './catalog';
import { islandFor, ISLAND_COUNT, terrainOn, tileIndexOn } from './island';
import { createSharedWorld, createWorld } from './world';
import { claimHarbour } from './claims';
import { primaryCity } from './city';
import type { Rotation } from './types';

const ROTATIONS: Rotation[] = [0, 1, 2, 3];

test('a harbour site is two rows of quay and three of pier, whichever way it faces', () => {
  for (const rotation of ROTATIONS) {
    const site = harbourSite(10, 10, rotation);
    expect(site.land).toHaveLength(HARBOUR_WIDTH * HARBOUR_LAND_DEPTH);
    expect(site.water).toHaveLength(HARBOUR_WIDTH * HARBOUR_WATER_DEPTH);
    expect(site.offshore).toHaveLength(HARBOUR_WIDTH);
    const { width, depth } = footprint('harbour', rotation);
    const xs = [...site.land, ...site.water].map((tile) => tile.x);
    const zs = [...site.land, ...site.water].map((tile) => tile.z);
    expect(Math.min(...xs)).toBe(10);
    expect(Math.min(...zs)).toBe(10);
    expect(Math.max(...xs) - Math.min(...xs) + 1).toBe(width);
    expect(Math.max(...zs) - Math.min(...zs) + 1).toBe(depth);
  }
});

test('the apron is the row of ground behind the quay, never part of the harbour', () => {
  for (const rotation of ROTATIONS) {
    const site = harbourSite(20, 20, rotation);
    const apron = harbourApron(20, 20, rotation);
    expect(apron).toHaveLength(HARBOUR_WIDTH);
    const occupied = new Set([...site.land, ...site.water].map((tile) => `${tile.x},${tile.z}`));
    for (const tile of apron) expect(occupied.has(`${tile.x},${tile.z}`)).toBe(false);
  }
});

test('every island offers a legal harbour site on both tested seeds', () => {
  for (const seed of [1, 2]) {
    const map = islandFor(seed);
    for (let home = 0; home < ISLAND_COUNT; home++) {
      const site = findHarbourSite(map, home);
      expect(site).not.toBeNull();
      const water = harbourSite(site!.x, site!.z, site!.rotation).water;
      for (const tile of water) expect(terrainOn(map, tile.x, tile.z)).toBe('water');
    }
  }
});

test('a new city stands at its own quay, its apron paved and its land tiles known', () => {
  const world = createWorld(1, 3);
  const city = primaryCity(world);
  const map = islandFor(world.seed, city.home);
  expect(city.roads).toEqual(harbourApron(city.harbour.x, city.harbour.z, city.harbour.rotation).map((tile) => tileIndexOn(map, tile.x, tile.z)));
  const land = harbourLandTiles(map, city.harbour);
  expect(land).toHaveLength(HARBOUR_WIDTH * HARBOUR_LAND_DEPTH);
  const site = harbourSite(city.harbour.x, city.harbour.z, city.harbour.rotation);
  expect(land).toEqual(site.land.map((tile) => tileIndexOn(map, tile.x, tile.z)));
});

test('a claimed shore refuses another city, and open shore elsewhere still accepts one', () => {
  const world = createSharedWorld();
  const first = findHarbourSite(islandFor(world.seed), 0)!;
  expect(claimHarbour(world, 'Tycho', 'terracotta', first.x, first.z, first.rotation).ok).toBe(true);
  expect(harbourPlacement(world, first.x, first.z, first.rotation).ok).toBe(false);
  const second = findHarbourSite(islandFor(world.seed), 6)!;
  expect(harbourPlacement(world, second.x, second.z, second.rotation).ok).toBe(true);
});

test('a site running off the map is out of bounds, not a crash', () => {
  const world = createSharedWorld();
  const map = islandFor(world.seed);
  expect(harbourPlacement(world, -4, 0, 0).reason).toBe('Out of bounds.');
  expect(harbourPlacement(world, map.width - 1, map.depth - 1, 0).reason).toBe('Out of bounds.');
});
