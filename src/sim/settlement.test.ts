import { expect, test } from 'bun:test';
import { entryTileIndex, footprintTiles, mapOf } from './grid';
import { islandAt, islandFor, ISLAND_COUNT, terrainOn, tileAtOn } from './island';
import { canUndoConstruction } from './history';
import { deserializeWorld, savedBeforeArchipelago, serializeWorld } from './save';
import { buildStarterNeighbourhood } from './scenario';
import { advance, createWorld, getSummary } from './world';
import { primaryCity } from './city';

for (let choice = 0; choice < ISLAND_COUNT * 2; choice++) {
  const seed = Math.floor(choice / ISLAND_COUNT) + 1;
  const home = choice % ISLAND_COUNT;
  test(`seed ${seed}, island ${home + 1} supports a settled, supplied neighbourhood and exact saves`, () => {
    const world = createWorld(seed, home);
    const map = mapOf(world);
    const island = map.islands[home];
    const city = primaryCity(world);
    expect(city.home).toBe(home);
    expect(map.entry).toEqual(island.entry);
    expect(world.roads).toContain(entryTileIndex(world));
    for (const tile of [...world.roads, ...footprintTiles(map, city.harbour)]) {
      const { x, z } = tileAtOn(map, tile);
      expect(islandAt(map, x, z)).toEqual(island);
      expect(terrainOn(map, x, z)).not.toBe('water');
    }
    expect(city.harbour.connected).toBe(true);
    expect(buildStarterNeighbourhood(world).ok).toBe(true);
    advance(world, 180);
    expect(getSummary(world).goal).toBe(true);
    expect(world.walkers.length).toBeGreaterThan(0);
    const loaded = deserializeWorld(serializeWorld(world));
    expect(loaded).toEqual(world);
    advance(world, 20);
    advance(loaded!, 20);
    expect(loaded).toEqual(world);
  });
}

test('selecting a home shares terrain without changing another city or the default map', () => {
  const original = islandFor(1);
  const originalEntry = { ...original.entry };
  const home = (original.home + 1) % ISLAND_COUNT;
  const selected = islandFor(1, home);
  expect(selected).toBe(islandFor(1, home));
  expect(selected.terrain).toBe(original.terrain);
  expect(selected.level).toBe(original.level);
  expect(selected.entry).toEqual(original.islands[home].entry);
  expect(islandFor(1).entry).toEqual(originalEntry);
  expect(primaryCity(createWorld(1)).home).toBe(original.home);
  expect(canUndoConstruction(createWorld(1, home), createWorld(1))).toBe(false);
});

test('invalid starting islands fail before founding a city', () => {
  for (const home of [-1, ISLAND_COUNT, 1.5, NaN, Infinity]) {
    expect(() => createWorld(1, home)).toThrow('Unknown starting island.');
  }
});

test('current saves require a valid explicit starting island', () => {
  const raw = JSON.parse(serializeWorld(createWorld(1, 0)));
  for (const home of [undefined, null, -1, ISLAND_COUNT, 1.5, '0']) {
    const cities = [{ ...raw.cities[0], home }];
    expect(deserializeWorld(JSON.stringify({ ...raw, cities }))).toBeNull();
  }
});

test('version 4 cities migrate to their original central island without changing their economy', () => {
  const world = createWorld(2);
  expect(buildStarterNeighbourhood(world).ok).toBe(true);
  advance(world, 60);
  const raw = JSON.parse(serializeWorld(world));
  const { id: _id, ...flatCity } = raw.cities[0];
  delete raw.cities;
  const legacy = { ...raw, ...flatCity, version: 4 };
  const saved = JSON.stringify(legacy);
  expect(savedBeforeArchipelago(saved)).toBe(false);
  expect(deserializeWorld(saved)).toEqual(world);
  legacy.version = 3;
  expect(savedBeforeArchipelago(JSON.stringify(legacy))).toBe(true);
  expect(deserializeWorld(JSON.stringify(legacy))).toBeNull();
});
