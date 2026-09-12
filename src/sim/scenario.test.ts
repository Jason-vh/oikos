import { expect, test } from 'bun:test';
import { createWorld } from './world';
import { primaryCity } from './city';
import { foundHarbour, foundingPlacement, FOUNDING_RANGE } from './founding';
import { foundSecondCity } from './testing';
import { buildStarterNeighbourhood, planStarterNeighbourhood, roadReachable } from './scenario';
import { foreignOccupancy } from './occupancy';
import { islandFor, tileIndexOn } from './island';
import { mapOf } from './grid';
import type { City, World } from './types';

const DETOUR_SEED = 700_001;

function detourFixture() {
  const map = islandFor(DETOUR_SEED);
  const ox = 12;
  const oz = 12;
  const setTile = (x: number, z: number, terrain: 'grass' | 'water') => {
    const index = tileIndexOn(map, x, z);
    map.terrain[index] = terrain;
    map.level[index] = 0;
  };
  for (let dz = -2; dz <= 3; dz++) for (let dx = -2; dx <= 3; dx++) setTile(ox + dx, oz + dz, 'water');
  setTile(ox, oz, 'grass');
  setTile(ox + 1, oz, 'grass');
  setTile(ox + 2, oz, 'grass');
  setTile(ox, oz + 1, 'grass');
  setTile(ox + 1, oz + 1, 'grass');
  setTile(ox + 2, oz + 1, 'grass');
  return {
    map,
    from: { x: ox, z: oz },
    direct: { x: ox + 1, z: oz },
    to: { x: ox + 2, z: oz },
    detour: { x: ox + 1, z: oz + 1 },
  };
}

function clearFoundingSite(world: World, city: City): { x: number; z: number } {
  const map = mapOf(world, city);
  const { entry } = map;
  for (let z = entry.z - FOUNDING_RANGE; z < entry.z; z++) {
    for (let x = entry.x - FOUNDING_RANGE; x <= entry.x + FOUNDING_RANGE; x++) {
      if (foundingPlacement(world, city, x, z).ok) return { x, z };
    }
  }
  throw new Error('No clear founding site.');
}

test('roadReachable detours around a foreign obstacle sitting on the only direct route', () => {
  const { map, from, direct, to, detour } = detourFixture();
  const world = createWorld(DETOUR_SEED);
  const city = primaryCity(world);
  const other = foundSecondCity(world, city.home, false);
  const fromIndex = tileIndexOn(map, from.x, from.z);
  const roads = new Set([fromIndex]);

  const clear = foreignOccupancy(world, city);
  const openPath = roadReachable(world, city, map, roads, clear, from, to, new Set());
  expect(openPath).not.toBeNull();
  expect(openPath!.some((tile) => tile.x === direct.x && tile.z === direct.z)).toBe(true);

  other.roads.push(tileIndexOn(map, direct.x, direct.z));
  const blocked = foreignOccupancy(world, city);
  const detourPath = roadReachable(world, city, map, roads, blocked, from, to, new Set());
  expect(detourPath).not.toBeNull();
  expect(detourPath!.some((tile) => tile.x === direct.x && tile.z === direct.z)).toBe(false);
  expect(detourPath!.some((tile) => tile.x === detour.x && tile.z === detour.z)).toBe(true);
});

test('planning does not mutate the source World, and its plan still builds cleanly with another city sharing the island', () => {
  const world = createWorld(1, 0);
  const city1 = primaryCity(world);
  const city2 = foundSecondCity(world, city1.home, false);
  const site = clearFoundingSite(world, city2);
  expect(foundHarbour(world, city2, site.x, site.z).ok).toBe(true);

  const before = structuredClone(world);
  const plan = planStarterNeighbourhood(world, city1);
  expect(plan).not.toBeNull();
  expect(world).toEqual(before);

  expect(buildStarterNeighbourhood(world, city1).ok).toBe(true);
});
