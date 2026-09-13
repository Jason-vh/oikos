import { expect, test } from 'bun:test';
import { footprintTiles, mapOf } from './grid';
import { islandFor } from './island';
import { deserializeWorld, serializeWorld } from './save';
import { createWorld } from './world';
import { primaryCity } from './city';

test('rejects missing, fractional, off-map, and foreign harbour sites instead of inventing a replacement', () => {
  const world = createWorld(1, 0);
  const raw = JSON.parse(serializeWorld(world));
  const other = createWorld(1, 7);
  const harbour = primaryCity(world).harbour;
  const otherHarbour = primaryCity(other).harbour;
  const sites = [
    { x: undefined, z: undefined },
    { x: .5, z: harbour.z },
    { x: -1, z: harbour.z },
    { x: islandFor(1).width, z: harbour.z },
    { x: 0, z: 0 },
    { x: otherHarbour.x, z: otherHarbour.z },
  ];
  for (const site of sites) {
    const cities = [{ ...raw.cities[0], harbour: { ...raw.cities[0].harbour, ...site } }];
    expect(deserializeWorld(JSON.stringify({ ...raw, cities }))).toBeNull();
  }
});

test('rejects road and building overlaps with the saved harbour', () => {
  const world = createWorld(1);
  const raw = JSON.parse(serializeWorld(world));
  const tile = footprintTiles(mapOf(world, primaryCity(world)), primaryCity(world).harbour)[0];
  raw.cities[0].roads.push(tile);
  expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  raw.cities[0].roads.pop();
  raw.cities[0].buildings.push({ ...raw.cities[0].harbour, id: raw.nextId++, kind: 'fountain' });
  expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
});
