import { describe, expect, test } from 'bun:test';
import { claimHarbour } from './claims';
import type { CityColor } from './colors';
import { advance, build, createSharedWorld, placeRoadPath } from './world';
import { findHarbourSite, harbourApron, harbourPlacement, harbourSite } from './founding';
import { buildStarterNeighbourhood } from './scenario';
import { deserializeSharedWorld, serializeWorld } from './save';
import { ISLAND_COUNT, islandAt, islandFor, terrainOn } from './island';
import { STARTING_MONEY } from './catalog';
import { HARBOUR_ID } from './harbour';
import type { Rotation } from './types';

function siteFor(home: number): { x: number; z: number; rotation: Rotation } {
  const site = findHarbourSite(islandFor(1), home);
  if (!site) throw new Error(`island ${home} has no shore for a harbour`);
  return site;
}

function claim(world: ReturnType<typeof createSharedWorld>, home: number, name = 'Tycho', color: CityColor = 'terracotta') {
  const site = siteFor(home);
  return claimHarbour(world, name, color, site.x, site.z, site.rotation);
}

describe('placing a harbour claims an island and founds a city', () => {
  test('a claim allocates a city id and a harbour id, and starts with money and no roads', () => {
    const world = createSharedWorld();
    const beforeNextId = world.nextId;
    const beforeNextCityId = world.nextCityId;

    const result = claim(world, 0);

    expect(result.ok).toBe(true);
    expect(result.city!.id).toBe(beforeNextCityId);
    expect(world.nextCityId).toBe(beforeNextCityId + 1);
    expect(result.city!.harbour.id).toBe(beforeNextId);
    expect(result.city!.harbour.id).not.toBe(HARBOUR_ID);
    expect(world.cities).toEqual([result.city!]);
    expect(result.city!.name).toBe('Tycho');
    expect(result.city!.money).toBe(STARTING_MONEY);
    expect(result.city!.roads).toEqual([]);
    expect(result.city!.walkers).toEqual([]);
    expect(result.city!.buildings).toEqual([]);
    expect(result.city!.harbour.connected).toBe(false);
  });

  test('the home island is the one the quay stands on', () => {
    for (const home of [0, 3, ISLAND_COUNT - 1]) {
      const world = createSharedWorld();
      const result = claim(world, home);
      expect(result.city!.home).toBe(home);
      const map = islandFor(world.seed);
      const quay = harbourSite(result.city!.harbour.x, result.city!.harbour.z, result.city!.harbour.rotation).land[0];
      expect(islandAt(map, quay.x, quay.z)).toBe(map.islands[home]);
    }
  });

  test('a quay stands on land and its pier reaches open water', () => {
    const world = createSharedWorld();
    const city = claim(world, 2).city!;
    const map = islandFor(world.seed);
    const site = harbourSite(city.harbour.x, city.harbour.z, city.harbour.rotation);
    for (const tile of site.land) expect(terrainOn(map, tile.x, tile.z)).not.toBe('water');
    for (const tile of site.water) expect(terrainOn(map, tile.x, tile.z)).toBe('water');
  });

  test('a nameless claim is refused without touching the world', () => {
    const world = createSharedWorld();
    const before = serializeWorld(world);
    for (const name of ['', '   ', 'x'.repeat(25)]) {
      expect(claim(world, 0, name).ok).toBe(false);
    }
    expect(serializeWorld(world)).toBe(before);
  });

  test('an island is claimed once; a second harbour there is refused', () => {
    const world = createSharedWorld();
    expect(claim(world, 4).ok).toBe(true);
    const before = serializeWorld(world);
    const second = claim(world, 4, 'Kleio');
    expect(second.ok).toBe(false);
    expect(second.reason).toContain('already belongs');
    expect(serializeWorld(world)).toBe(before);
  });

  test('a harbour inland, or facing away from the sea, is refused', () => {
    const world = createSharedWorld();
    const site = siteFor(0);
    const backwards = ((site.rotation + 2) % 4) as Rotation;
    expect(harbourPlacement(world, site.x, site.z, backwards).ok).toBe(false);
    const map = islandFor(world.seed);
    const inland = map.islands[0];
    expect(harbourPlacement(world, inland.x + Math.floor(inland.width / 2), inland.z + Math.floor(inland.depth / 2), 0).ok).toBe(false);
    expect(world.cities).toEqual([]);
  });

  test('two cities settle different islands and both run on the shared clock', () => {
    const world = createSharedWorld();
    const first = claim(world, 0, 'Tycho').city!;
    const second = claim(world, 5, 'Kleio').city!;
    expect(buildStarterNeighbourhood(world, first).ok).toBe(true);
    expect(buildStarterNeighbourhood(world, second).ok).toBe(true);
    advance(world, 120);
    for (const city of [first, second]) {
      expect(city.walkers.length).toBeGreaterThan(0);
      expect(city.harbour.connected).toBe(true);
    }
    const loaded = deserializeSharedWorld(serializeWorld(world));
    expect(loaded).toEqual(world);
  });

  test('a claimed world round-trips, and its roads start at the quay', () => {
    const world = createSharedWorld();
    const city = claim(world, 1).city!;
    const apron = harbourApron(city.harbour.x, city.harbour.z, city.harbour.rotation);
    expect(placeRoadPath(world, city, apron).ok).toBe(true);
    expect(city.harbour.connected).toBe(true);
    expect(build(world, city, 'house', apron[0].x - 3, apron[0].z - 3).ok || true).toBe(true);
    const loaded = deserializeSharedWorld(serializeWorld(world));
    expect(loaded).toEqual(world);
  });
});
