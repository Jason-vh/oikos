import { expect, test } from 'bun:test';
import { advance, build, createWorld, spawnWalker, tilesTravelled } from './world';
import { primaryCity } from './city';
import { walkerSpeed, STEP } from './balance';
import { connect, roadSpur, spotFor } from './testing';
import { buildStarterNeighbourhood } from './scenario';
import { tileIndexOn } from './island';
import { mapOf } from './grid';
import type { Walker, World } from './types';
import { HUNT_SECONDS } from './gathering';

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
  expect(tilesTravelled(world, walker)).toBeCloseTo(walkerSpeed(walker.kind) * STEP * 2, 10);
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

test('a walker that has stopped is not redrawn as one still walking', () => {
  const world = createWorld(1, 0);
  buildStarterNeighbourhood(world, primaryCity(world));
  const lodge = spotFor(world, 'lodge');
  expect(lodge).not.toBeNull();
  expect(build(world, primaryCity(world), 'lodge', lodge!.x, lodge!.z).ok).toBe(true);
  connect(world, primaryCity(world).buildings.at(-1)!);
  const behind = new Map<number, { plan: string; travelled: number }>();
  let backwards = 0;
  for (let beat = 0; beat < 900; beat++) {
    advance(world, STEP);
    for (let frame = 0; frame < 15; frame++) {
      const seen = world.time - .43 + frame / 60;
      for (const walker of primaryCity(world).walkers) {
        const travelled = Math.min(Math.max(walkerSpeed(walker.kind) * (seen - walker.departedAt), 0), walker.path.length - 1);
        const plan = walker.path.join(',');
        const was = behind.get(walker.id);
        if (was && was.plan === plan && travelled < was.travelled - 1e-9) backwards += 1;
        behind.set(walker.id, { plan, travelled });
      }
    }
  }
  expect(backwards).toBe(0);
});

test('a hunter turning for home departs now, not when it first set out', () => {
  const world = createWorld(1, 0);
  buildStarterNeighbourhood(world, primaryCity(world));
  const lodge = spotFor(world, 'lodge')!;
  expect(build(world, primaryCity(world), 'lodge', lodge.x, lodge.z).ok).toBe(true);
  connect(world, primaryCity(world).buildings.at(-1)!);
  let turned = false;
  for (let beat = 0; beat < 4000 && !turned; beat++) {
    advance(world, STEP);
    const hunter = primaryCity(world).walkers.find((walker) => walker.kind === 'hunter' && walker.returning);
    if (!hunter) continue;
    turned = true;
    expect(world.time - hunter.departedAt).toBeLessThan(1);
    expect(tilesTravelled(world, hunter)).toBeLessThan(hunter.path.length - 1);
  }
  expect(turned).toBe(true);
});

test('work is scheduled, not counted down: it says when it began and when it ends', () => {
  const world = createWorld(1, 0);
  buildStarterNeighbourhood(world, primaryCity(world));
  const lodge = spotFor(world, 'lodge')!;
  expect(build(world, primaryCity(world), 'lodge', lodge.x, lodge.z).ok).toBe(true);
  connect(world, primaryCity(world).buildings.at(-1)!);
  let task = null as Walker['task'];
  let began = 0;
  for (let beat = 0; beat < 4000 && task === null; beat++) {
    advance(world, STEP);
    const working = primaryCity(world).walkers.find((walker) => walker.task !== null);
    if (working) {
      task = working.task;
      began = world.time;
    }
  }
  expect(task).not.toBeNull();
  expect(task!.kind).toBe('hunt');
  expect(task!.since).toBeLessThanOrEqual(began);
  expect(task!.until - task!.since).toBeCloseTo(HUNT_SECONDS, 9);

  const seen = new Set<number>();
  for (let beat = 0; beat < 40; beat++) {
    advance(world, STEP);
    const working = primaryCity(world).walkers.find((walker) => walker.task !== null);
    if (working) seen.add(working.task!.until);
  }
  expect(seen.size).toBeLessThanOrEqual(2);
});
