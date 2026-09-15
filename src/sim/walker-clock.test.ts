import { expect, test } from 'bun:test';
import { advance, createWorld, spawnWalker, tilesTravelled } from './world';
import { primaryCity } from './city';
import { WALKER_SPEED, STEP } from './balance';
import { roadSpur } from './testing';
import { buildStarterNeighbourhood } from './scenario';
import { tileIndexOn } from './island';
import { mapOf } from './grid';
import type { Walker, World } from './types';

function fixture(): { world: World; walker: Walker } {
  const world = createWorld();
  const city = primaryCity(world);
  const map = mapOf(world, city);
  const spur = roadSpur(world, 6);
  const path = spur.map((tile) => tileIndexOn(map, tile.x, tile.z));
  const walker = spawnWalker(world, city, {
    kind: 'porter',
    homeId: city.harbour.id,
    targetId: null,
    path,
    step: 0,
    progress: 0,
    food: null,
    cargo: 0,
    returning: false,
  });
  return { world, walker };
}

test('a walker departs on the world clock and its position follows from it', () => {
  const { world, walker } = fixture();
  expect(walker.departedAt).toBe(world.time);
  advance(world, STEP * 2);
  expect(tilesTravelled(world, walker)).toBeCloseTo(WALKER_SPEED * STEP * 2, 10);
  expect(walker.step + walker.progress).toBeCloseTo(tilesTravelled(world, walker), 10);
});

test('the same elapsed time moves a walker equally, however it is divided into steps', () => {
  const coarse = fixture();
  const fine = fixture();
  advance(coarse.world, 1);
  for (let i = 0; i < 4; i++) advance(fine.world, STEP);
  expect(coarse.walker.step).toBe(fine.walker.step);
  expect(coarse.walker.progress).toBeCloseTo(fine.walker.progress, 10);
});

test('every walker in a working city stands where its own clock says', () => {
  const world = createWorld();
  buildStarterNeighbourhood(world, primaryCity(world));
  let seen = 0;
  for (let tick = 0; tick < 400; tick++) {
    advance(world, STEP);
    for (const walker of primaryCity(world).walkers) {
      seen += 1;
      expect(tilesTravelled(world, walker)).toBeCloseTo(walker.step + walker.progress, 9);
    }
  }
  expect(seen).toBeGreaterThan(100);
});
