import { expect, test } from 'bun:test';
import { footprint } from './catalog';
import { islandFor } from './island';
import { serializeWorld } from './save';
import { buildStarterNeighbourhood } from './scenario';
import { spotFor } from './testing';
import { wildlifeObstacles } from './wildlife';
import { build, createWorld, demolish } from './world';
import { primaryCity } from './city';

test('the obstacle set matches the original per-animal road and building checks on every tile', () => {
  const world = createWorld(2);
  expect(buildStarterNeighbourhood(world).ok).toBe(true);
  const map = islandFor(world.seed);
  const before = serializeWorld(world);
  const obstacles = wildlifeObstacles(world);
  for (let z = 0; z < map.depth; z++) {
    for (let x = 0; x < map.width; x++) {
      const tile = z * map.width + x;
      const road = primaryCity(world).roads.includes(tile);
      const building = primaryCity(world).buildings.some((candidate) => {
        const { width, depth } = footprint(candidate.kind, candidate.rotation);
        return x >= candidate.x && z >= candidate.z && x < candidate.x + width && z < candidate.z + depth;
      });
      expect(obstacles.has(tile)).toBe(road || building);
    }
  }
  expect(serializeWorld(world)).toBe(before);
});

test('new construction and demolition are reflected without stale obstacle caches', () => {
  const world = createWorld(1);
  const map = islandFor(world.seed);
  const spot = spotFor(world, 'house')!;
  const tile = spot.z * map.width + spot.x;
  const before = wildlifeObstacles(world);
  expect(before.has(tile)).toBe(false);
  expect(build(world, primaryCity(world), 'house', spot.x, spot.z, 1).ok).toBe(true);
  const built = wildlifeObstacles(world);
  expect(built.has(tile)).toBe(true);
  expect(before.has(tile)).toBe(false);
  expect(demolish(world, primaryCity(world), spot.x, spot.z).ok).toBe(true);
  expect(wildlifeObstacles(world).has(tile)).toBe(false);
  expect(built.has(tile)).toBe(true);
});
