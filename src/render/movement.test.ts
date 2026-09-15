import { expect, test } from 'bun:test';
import * as T from 'three';
import { CityScene } from './city';
import type { Stage } from './stage';
import { islandFor } from '../sim/island';
import { createWorld } from '../sim/world';
import { primaryCity } from '../sim/city';
import { roadSpur } from '../sim/testing';
import { mapOf } from '../sim/grid';
import { tileIndexOn } from '../sim/island';
import { WALKER_SPEED } from '../sim/balance';
import type { Walker } from '../sim/types';

function fixture() {
  const world = createWorld();
  const stage = { scene: new T.Scene(), shadows() {}, shadowsFromMotion() {}, invalidate() {} } as Stage;
  const city = new CityScene(stage, islandFor(world.seed), true);
  const owner = primaryCity(world);
  const walker: Walker = {
    id: world.nextId++,
    kind: 'porter',
    homeId: owner.harbour.id,
    targetId: null,
    path: roadSpur(world, 4).map((tile) => tileIndexOn(mapOf(world, owner), tile.x, tile.z)),
    departedAt: 0,
    step: 0,
    progress: 0,
    food: null,
    cargo: 0,
    returning: false,
    overland: [],
    quarry: null,
    working: 0,
  };
  owner.walkers.push(walker);
  city.setWorldTime(0);
  city.sync(world);
  return { city, world, walker, at: () => city.moverPoint(walker.id)!.clone() };
}

test('a walker stands where the world clock puts it, not where a tween left it', () => {
  const { city, at } = fixture();
  const start = at();
  city.setWorldTime(1 / WALKER_SPEED);
  city.animate(0, 1 / 60, 1);
  const afterOneTile = at();
  expect(afterOneTile.distanceTo(start)).toBeGreaterThan(0);
  city.setWorldTime(2 / WALKER_SPEED);
  city.animate(0, 1 / 60, 1);
  expect(at().distanceTo(afterOneTile)).toBeCloseTo(afterOneTile.distanceTo(start), 6);
});

test('a repeated sync at the same instant moves nothing', () => {
  const { city, world, at } = fixture();
  city.setWorldTime(.5 / WALKER_SPEED);
  city.animate(0, 1 / 60, 1);
  const placed = at();
  for (let repeat = 0; repeat < 3; repeat++) city.sync(world);
  expect(at().distanceTo(placed)).toBe(0);
});

test('a beat that never arrives costs the walker nothing', () => {
  const even = fixture();
  const skipped = fixture();
  for (let beat = 1; beat <= 4; beat++) {
    even.city.setWorldTime(beat * .25);
    even.city.animate(0, .25, 1);
  }
  skipped.city.setWorldTime(.5);
  skipped.city.animate(0, .5, 1);
  skipped.city.setWorldTime(1);
  skipped.city.animate(0, .5, 1);
  expect(skipped.at().distanceTo(even.at())).toBeCloseTo(0, 9);
});

test('animals are given the simulated interval their update covered', () => {
  const world = createWorld();
  const stage = { scene: new T.Scene(), shadows() {}, shadowsFromMotion() {}, invalidate() {} } as Stage;
  const city = new CityScene(stage, islandFor(world.seed), true);
  const animal = world.wildlife[0];
  city.setWorldTime(0);
  city.sync(world);
  world.time = 1;
  world.wildlife = world.wildlife.map((entry) => (entry.id === animal.id ? { ...entry, x: entry.x + .4 } : entry));
  city.setWorldTime(1);
  city.sync(world);
  const moved = city.moverPoint(animal.id)!.clone();
  city.animate(0, .25, 1);
  const quarter = city.moverPoint(animal.id)!.clone();
  expect(quarter.distanceTo(moved)).toBeGreaterThan(0);
  city.animate(0, .75, 1);
  const whole = city.moverPoint(animal.id)!.clone();
  city.animate(0, .5, 1);
  expect(city.moverPoint(animal.id)!.distanceTo(whole)).toBe(0);
  city.dispose();
});
