import { expect, test } from 'bun:test';
import { WorldClock } from './world-clock';

function beat(clock: WorldClock, worldTime: number, frames = 15): void {
  for (let frame = 0; frame < frames; frame++) clock.advance(1 / 60);
  clock.observe(worldTime);
}

test('the clock runs between snapshots rather than waiting for them', () => {
  const clock = new WorldClock(10);
  clock.advance(.016);
  clock.advance(.016);
  expect(clock.now).toBeCloseTo(10.032, 10);
});

test('a running world is followed at its own pace, through an uneven beat', () => {
  const clock = new WorldClock(0);
  let world = 0;
  for (let round = 0; round < 40; round++) {
    world += .25;
    beat(clock, world);
  }
  const steady = clock.now;
  expect(steady).toBeGreaterThan(world - .1);
  expect(steady).toBeLessThan(world + .75);
  world += .5;
  beat(clock, world, 30);
  expect(clock.now - steady).toBeGreaterThan(.4);
  expect(clock.now - steady).toBeLessThan(.6);
});

test('a world that has stopped does not keep the clock walking', () => {
  const clock = new WorldClock(5);
  for (let round = 0; round < 20; round++) beat(clock, 5);
  const held = clock.now;
  for (let round = 0; round < 20; round++) beat(clock, 5);
  expect(clock.now).toBe(held);
  expect(clock.now).toBeLessThanOrEqual(5.75);
});

test('the clock never walks backwards while the world keeps time', () => {
  const clock = new WorldClock(0);
  let world = 0;
  let last = clock.now;
  for (const arrival of [.24, .27, .25, .5, .23, .26, .25, .24, .26, .25, .25, .25]) {
    world += arrival;
    beat(clock, world, Math.round(arrival * 60));
    expect(clock.now).toBeGreaterThanOrEqual(last);
    last = clock.now;
  }
});

test('a long absence resets the clock rather than crawling back to the world', () => {
  const clock = new WorldClock(0);
  clock.observe(12);
  expect(clock.now).toBe(12);
});
