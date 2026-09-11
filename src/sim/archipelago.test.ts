import { expect, test } from 'bun:test';
import { generateArchipelago, ISLAND_COUNT, islandAt, islandFor, terrainOn } from './island';
import { createWorld } from './world';
import { bfsReachable } from './grid';
import { homeIsland } from './testing';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

function landmasses(map: ReturnType<typeof generateArchipelago>): number[] {
  const seen = new Uint8Array(map.width * map.depth);
  const sizes: number[] = [];
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || map.terrain[start] === 'water') continue;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const index = stack.pop()!;
      size++;
      const x = index % map.width;
      const z = (index - x) / map.width;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= map.width || nz >= map.depth) continue;
        const next = nz * map.width + nx;
        if (seen[next] || map.terrain[next] === 'water') continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    sizes.push(size);
  }
  return sizes;
}

test('every seed yields eight islands, each its own landmass with a harbour on land', () => {
  for (const seed of SEEDS) {
    const map = generateArchipelago(seed);
    expect(map.islands).toHaveLength(ISLAND_COUNT);
    expect(landmasses(map)).toHaveLength(ISLAND_COUNT);
    for (const island of map.islands) {
      expect(island.x).toBeGreaterThanOrEqual(0);
      expect(island.z).toBeGreaterThanOrEqual(0);
      expect(island.x + island.width).toBeLessThanOrEqual(map.width);
      expect(island.z + island.depth).toBeLessThanOrEqual(map.depth);
      expect(terrainOn(map, island.entry.x, island.entry.z)).not.toBe('water');
      expect(islandAt(map, island.entry.x, island.entry.z)).toEqual(island);
    }
  }
});

test('islands never share a bounding box, and the home island is the most central', () => {
  const map = generateArchipelago(1);
  for (const island of map.islands) {
    for (const other of map.islands) {
      if (other === island) continue;
      const apart = other.x >= island.x + island.width || island.x >= other.x + other.width
        || other.z >= island.z + island.depth || island.z >= other.z + other.depth;
      expect(apart).toBe(true);
    }
  }
  const distance = (index: number) => {
    const island = map.islands[index];
    return (island.x + island.width / 2 - map.width / 2) ** 2 + (island.z + island.depth / 2 - map.depth / 2) ** 2;
  };
  for (let index = 0; index < map.islands.length; index++) expect(distance(map.home)).toBeLessThanOrEqual(distance(index));
  expect(map.entry).toEqual(map.islands[map.home].entry);
});

test('the same seed always builds the same sea, and different seeds do not', () => {
  expect(generateArchipelago(3).terrain).toEqual(generateArchipelago(3).terrain);
  expect(generateArchipelago(3).terrain).not.toEqual(generateArchipelago(4).terrain);
});

test('a new city starts on the home island, reaching its own shore and no other', () => {
  for (const seed of SEEDS) {
    const world = createWorld(seed);
    const map = islandFor(seed);
    const island = homeIsland(world);
    expect(world.roads.length).toBeGreaterThan(0);
    const reach = bfsReachable(map, new Set(world.roads), world.roads[0]);
    for (const tile of reach) {
      const x = tile % map.width;
      const z = (tile - x) / map.width;
      expect(islandAt(map, x, z)).toEqual(island);
    }
    expect(world.harbour.x).toBeGreaterThanOrEqual(island.x);
    expect(world.harbour.x).toBeLessThan(island.x + island.width);
  }
});

test('wildlife spawns on every island, on ground each species can hold', () => {
  const world = createWorld(1);
  const map = islandFor(1);
  const ashore = world.wildlife.filter((animal) => animal.kind === 'boar' || animal.kind === 'rabbit');
  const populated = new Set(ashore.map((animal) => map.islands.indexOf(islandAt(map, Math.floor(animal.homeX), Math.floor(animal.homeZ))!)));
  expect(populated).not.toContain(-1);
  expect(populated.size).toBe(ISLAND_COUNT);
  for (const animal of world.wildlife) {
    const terrain = terrainOn(map, Math.floor(animal.x), Math.floor(animal.z));
    if (animal.kind === 'fish') expect(terrain).toBe('water');
    if (animal.kind === 'boar') expect(terrain).not.toBe('water');
  }
});
