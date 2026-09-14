import { expect, test } from 'bun:test';
import * as T from 'three';
import { CityScene } from './city';
import type { Stage } from './stage';
import { islandFor } from '../sim/island';
import { createWorld } from '../sim/world';
import { primaryCity } from '../sim/city';
import type { Walker, World } from '../sim/types';

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
    path: [owner.roads[0], owner.roads[1], owner.roads[2]],
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
  city.sync(world);
  return { city, world, walker, at: () => city.moverPoint(walker.id)!.clone() };
}

function step(world: World, walker: Walker, progress: number): World {
  walker.progress = progress;
  return world;
}

test('a repeated sync of an unchanged walker never interrupts its journey', () => {
  const { city, world, walker, at } = fixture();
  try {
    city.sync(step(world, walker, .5));
    city.animate(0, .12, 1);
    for (let repeat = 0; repeat < 3; repeat++) city.sync(world);
    city.animate(0, .13, 1);
    const arrived = at();
    city.animate(0, .25, 1);
    expect(at().distanceTo(arrived)).toBe(0);
  } finally {
    city.dispose();
  }
});

test('a journey is spread over the interval its updates actually arrive in', () => {
  const { city, world, walker, at } = fixture();
  try {
    city.sync(step(world, walker, .5));
    city.animate(0, .5, 1);
    const target = at();
    city.sync(step(world, walker, 1));
    city.animate(0, .25, 1);
    const halfway = at();
    expect(halfway.distanceTo(target)).toBeGreaterThan(0);
    city.animate(0, .25, 1);
    const arrived = at();
    expect(arrived.distanceTo(halfway)).toBeGreaterThan(0);
    city.animate(0, .25, 1);
    expect(at().distanceTo(arrived)).toBe(0);
  } finally {
    city.dispose();
  }
});
