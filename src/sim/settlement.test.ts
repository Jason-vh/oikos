import { expect, test } from 'bun:test';
import { footprintTiles, harbourDoors, mapOf } from './grid';
import { islandAt, islandFor, ISLAND_COUNT, tileAtOn } from './island';
import { deserializeWorld, serializeWorld } from './save';
import { buildStarterNeighbourhood } from './scenario';
import { advance, createWorld, getSummary } from './world';
import { primaryCity } from './city';

for (let choice = 0; choice < ISLAND_COUNT * 2; choice++) {
  const seed = Math.floor(choice / ISLAND_COUNT) + 1;
  const home = choice % ISLAND_COUNT;
  test(`seed ${seed}, island ${home + 1} supports a settled, supplied neighbourhood and exact saves`, () => {
    const world = createWorld(seed, home);
    const map = mapOf(world, primaryCity(world));
    const island = map.islands[home];
    const city = primaryCity(world);
    expect(city.home).toBe(home);
    expect(city.roads.length).toBeGreaterThan(0);
    expect(harbourDoors(world, city).some((tile) => city.roads.includes(tile))).toBe(true);
    for (const tile of footprintTiles(map, city.harbour)) {
      const { x, z } = tileAtOn(map, tile);
      expect(islandAt(map, x, z)).toEqual(island);
    }
    expect(city.harbour.connected).toBe(true);
    expect(buildStarterNeighbourhood(world, primaryCity(world)).ok).toBe(true);
    expect(primaryCity(world).harbour.connected).toBe(true);
    advance(world, 240);
    expect(getSummary(primaryCity(world)).goal).toBe(true);
    expect(city.walkers.length).toBeGreaterThan(0);
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

