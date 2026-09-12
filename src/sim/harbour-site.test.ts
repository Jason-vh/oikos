import { expect, test } from 'bun:test';
import { footprintTiles, mapOf } from './grid';
import { islandFor, tileAtOn } from './island';
import { deserializeWorld, serializeWorld } from './save';
import { createWorld, demolish } from './world';

for (const version of [4, 5, 6]) {
  test(`version ${version} keeps its harbour site after the entry roads are demolished`, () => {
    const world = createWorld(2);
    const original = { ...world.harbour };
    for (const tile of [...world.roads]) {
      const { x, z } = tileAtOn(mapOf(world), tile);
      expect(demolish(world, x, z).ok).toBe(true);
    }
    expect(world.harbour.connected).toBe(false);
    const raw = JSON.parse(serializeWorld(world));
    raw.version = version;
    if (version === 4) delete raw.home;
    const loaded = deserializeWorld(JSON.stringify(raw));
    expect(loaded).toEqual(world);
    expect(loaded!.harbour.x).toBe(original.x);
    expect(loaded!.harbour.z).toBe(original.z);
    expect(deserializeWorld(serializeWorld(loaded!))).toEqual(loaded);
  });
}

test('rejects missing, fractional, off-map, and foreign harbour sites instead of inventing a replacement', () => {
  const world = createWorld(1, 0);
  const raw = JSON.parse(serializeWorld(world));
  const other = createWorld(1, 7);
  const sites = [
    { x: undefined, z: undefined },
    { x: .5, z: world.harbour.z },
    { x: -1, z: world.harbour.z },
    { x: islandFor(1).width, z: world.harbour.z },
    { x: 0, z: 0 },
    { x: other.harbour.x, z: other.harbour.z },
  ];
  for (const site of sites) {
    expect(deserializeWorld(JSON.stringify({ ...raw, harbour: { ...raw.harbour, ...site } }))).toBeNull();
  }
});

test('rejects road and building overlaps with the saved harbour', () => {
  const world = createWorld(1);
  const raw = JSON.parse(serializeWorld(world));
  const tile = footprintTiles(mapOf(world), world.harbour)[0];
  raw.roads.push(tile);
  expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  raw.roads.pop();
  raw.buildings.push({ ...raw.harbour, id: raw.nextId++, kind: 'fountain' });
  expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
});
