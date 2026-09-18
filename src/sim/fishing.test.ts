import { describe, expect, test } from 'bun:test';
import { advance, build, buildingStatus, createWorld, demolish } from './world';
import { ISLAND_COUNT, islandFor, terrainOn, tileAtOn, tileIndexOn } from './island';
import { connect, onHomeIsland, shoreSpotFor, spotFor } from './testing';
import { FISH_RANGE, gatherReach } from './gathering';
import { deserializeWorld, serializeWorld } from './save';
import { primaryCity } from './city';
import { buildStarterNeighbourhood } from './scenario';
import { seawardOf, shoreSite } from './shore';
import { findHarbourSite } from './founding';
import type { Building, Tile, World } from './types';

function homeShoal(world: World): Tile {
  const shoal = world.wildlife.find((animal) => {
    if (animal.kind !== 'fish') return false;
    const map = islandFor(world.seed);
    return [[3, 0], [-3, 0], [0, 3], [0, -3]].some(([dx, dz]) => onHomeIsland(world, Math.floor(animal.homeX) + dx, Math.floor(animal.homeZ) + dz))
      && terrainOn(map, Math.floor(animal.homeX), Math.floor(animal.homeZ)) === 'water';
  })!;
  return { x: Math.floor(shoal.homeX), z: Math.floor(shoal.homeZ) };
}

function buildFishingCity(world: World): { wharf: Building; granary: Building } {
  const site = shoreSpotFor(world, 'wharf', homeShoal(world))!;
  expect(site).not.toBeNull();
  expect(build(world, primaryCity(world), 'wharf', site.x, site.z, site.rotation).ok).toBe(true);
  const wharf = primaryCity(world).buildings[0];
  expect(connect(world, wharf).ok).toBe(true);
  const granarySpot = spotFor(world, 'granary', site)!;
  expect(build(world, primaryCity(world), 'granary', granarySpot.x, granarySpot.z).ok).toBe(true);
  const granary = primaryCity(world).buildings[1];
  expect(connect(world, granary).ok).toBe(true);
  for (let count = 0; count < 2; count++) {
    const houseSpot = spotFor(world, 'house', islandFor(world.seed).entry)!;
    expect(build(world, primaryCity(world), 'house', houseSpot.x, houseSpot.z).ok).toBe(true);
    expect(connect(world, primaryCity(world).buildings[2 + count]).ok).toBe(true);
  }
  return { wharf, granary };
}

function runUntil(world: World, seconds: number, done: () => boolean): boolean {
  for (let step = 0; step < seconds * 4 && !done(); step++) advance(world, .25);
  return done();
}

describe('a wharf on the shore', () => {
  test('its quay stands on level shore and its jetty over open water', () => {
    const world = createWorld(1);
    const site = shoreSpotFor(world, 'wharf', homeShoal(world))!;
    const map = islandFor(world.seed);
    const rows = shoreSite('wharf', site.x, site.z, site.rotation);
    for (const tile of rows.land) expect(terrainOn(map, tile.x, tile.z)).not.toBe('water');
    for (const tile of rows.water) expect(terrainOn(map, tile.x, tile.z)).toBe('water');
    expect(build(world, primaryCity(world), 'wharf', site.x, site.z, site.rotation).ok).toBe(true);
  });

  test('a wharf set back from the shore is refused, at no cost', () => {
    const world = createWorld(1);
    const site = shoreSpotFor(world, 'wharf', homeShoal(world))!;
    const inland = seawardOf(site, site.rotation, -3);
    const money = primaryCity(world).money;
    const result = build(world, primaryCity(world), 'wharf', inland.x, inland.z, site.rotation);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('The jetty needs open water behind the quay.');
    expect(primaryCity(world).money).toBe(money);
  });

  test('a wharf afloat is refused for want of shore', () => {
    const world = createWorld(1);
    const site = shoreSpotFor(world, 'wharf', homeShoal(world))!;
    const afloat = seawardOf(site, site.rotation, 3);
    const result = build(world, primaryCity(world), 'wharf', afloat.x, afloat.z, site.rotation);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('A wharf stands on flat, open shore with water behind it.');
  });

  test('it claims no island: every island on seeds 1 to 8 offers a site by its harbour', () => {
    for (let seed = 1; seed <= 8; seed++) {
      for (let home = 0; home < ISLAND_COUNT; home++) {
        const world = createWorld(seed, home);
        const quay = findHarbourSite(islandFor(seed, home), home)!;
        const site = shoreSpotFor(world, 'wharf', quay);
        expect(site).not.toBeNull();
      }
    }
  });
});

describe('the wharf reach', () => {
  test('runs over the water and stops at the shore', () => {
    const world = createWorld(1);
    const site = shoreSpotFor(world, 'wharf', homeShoal(world))!;
    const map = islandFor(world.seed);
    const reach = gatherReach(world, primaryCity(world), 'wharf', site.x, site.z, site.rotation);
    const jetty = shoreSite('wharf', site.x, site.z, site.rotation).water;
    expect(reach.length).toBeGreaterThan(0);
    for (const tile of reach) {
      const { x, z } = tileAtOn(map, tile);
      expect(terrainOn(map, x, z)).toBe('water');
      const away = Math.min(...jetty.map((berth) => Math.abs(x - berth.x) + Math.abs(z - berth.z)));
      expect(away).toBeLessThanOrEqual(FISH_RANGE + 1);
      expect(reach).not.toContain(tileIndexOn(map, site.x, site.z));
    }
  });
});

describe('fishing', () => {
  test('a boat works a shoal and the catch reaches a granary by cart', () => {
    const world = createWorld(1);
    const { granary } = buildFishingCity(world);
    const map = islandFor(world.seed);
    expect(runUntil(world, 400, () => primaryCity(world).walkers.some((walker) => walker.kind === 'fisher'))).toBe(true);
    const boat = primaryCity(world).walkers.find((walker) => walker.kind === 'fisher')!;
    for (const tile of boat.path) {
      const { x, z } = tileAtOn(map, tile);
      expect(terrainOn(map, x, z)).toBe('water');
    }
    expect(runUntil(world, 600, () => (granary.stores.fish ?? 0) > 0)).toBe(true);
    expect(world.wildlife.some((animal) => animal.kind === 'fish' && animal.respawnAt !== null)).toBe(true);
    expect(primaryCity(world).produced).toBeGreaterThan(0);
  });

  test('a boat at sea survives a save and carries on fishing', () => {
    const world = createWorld(1);
    buildFishingCity(world);
    expect(runUntil(world, 400, () => primaryCity(world).walkers.some((walker) => walker.kind === 'fisher'))).toBe(true);
    const reloaded = deserializeWorld(serializeWorld(world))!;
    expect(reloaded).not.toBeNull();
    expect(primaryCity(reloaded).walkers.some((walker) => walker.kind === 'fisher')).toBe(true);
    const granary = primaryCity(reloaded).buildings[1];
    expect(runUntil(reloaded, 600, () => (granary.stores.fish ?? 0) > 0)).toBe(true);
  });

  test('demolishing the wharf takes its boat with it and releases the shoal', () => {
    const world = createWorld(1);
    const { wharf } = buildFishingCity(world);
    expect(runUntil(world, 400, () => primaryCity(world).walkers.some((walker) => walker.kind === 'fisher'))).toBe(true);
    expect(demolish(world, primaryCity(world), wharf.x, wharf.z).ok).toBe(true);
    expect(primaryCity(world).walkers.some((walker) => walker.kind === 'fisher')).toBe(false);
    expect(world.wildlife.every((animal) => !animal.cornered)).toBe(true);
  });

  test('a wharf with no shoals left in reach says so', () => {
    const world = createWorld(1);
    const { wharf } = buildFishingCity(world);
    expect(runUntil(world, 400, () => wharf.workers >= 3)).toBe(true);
    for (const animal of world.wildlife) {
      if (animal.kind === 'fish') animal.respawnAt = world.time + 1000;
    }
    expect(runUntil(world, 200, () => !primaryCity(world).walkers.some((walker) => walker.kind === 'fisher'))).toBe(true);
    expect(buildingStatus(world, primaryCity(world), wharf)).toContain('No shoals within reach; the fish will return.');
  });

  test('a wharf off the road network reports that first', () => {
    const world = createWorld(1);
    const site = shoreSpotFor(world, 'wharf', homeShoal(world))!;
    build(world, primaryCity(world), 'wharf', site.x, site.z, site.rotation);
    const wharf = primaryCity(world).buildings[0];
    expect(buildingStatus(world, primaryCity(world), wharf)).toEqual(['Not linked to a road; nobody can reach it.']);
    expect(tileIndexOn(islandFor(world.seed), site.x, site.z)).toBeGreaterThan(0);
  });
});

describe('the first catch', () => {
  test('reaches a granary within ninety seconds of the wharf being built, on seeds 1 to 8', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const world = createWorld(seed);
      const city = primaryCity(world);
      expect(buildStarterNeighbourhood(world, city).ok).toBe(true);
      advance(world, 180);
      const site = shoreSpotFor(world, 'wharf', homeShoal(world))!;
      expect(build(world, city, 'wharf', site.x, site.z, site.rotation).ok).toBe(true);
      const wharf = city.buildings[city.buildings.length - 1];
      expect(connect(world, wharf).ok).toBe(true);
      const granarySpot = spotFor(world, 'granary', site)!;
      expect(build(world, city, 'granary', granarySpot.x, granarySpot.z).ok).toBe(true);
      const granary = city.buildings[city.buildings.length - 1];
      expect(connect(world, granary).ok).toBe(true);
      const before = granary.stores.fish ?? 0;
      const started = world.time;
      expect(runUntil(world, 90, () => (granary.stores.fish ?? 0) > before)).toBe(true);
      expect(world.time - started).toBeLessThan(90);
    }
  });
});
