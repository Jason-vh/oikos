import { expect, test } from 'bun:test';
import { WorldClock } from './world-clock';

test('the clock runs between snapshots rather than waiting for them', () => {
  const clock = new WorldClock(10);
  clock.advance(.016);
  clock.advance(.016);
  expect(clock.now).toBeCloseTo(10.032, 10);
});

test('an uneven beat barely moves a running clock', () => {
  const clock = new WorldClock(0);
  for (let beat = 1; beat <= 40; beat++) {
    for (let frame = 0; frame < 15; frame++) clock.advance(1 / 60);
    clock.observe(beat * .25);
  }
  const even = clock.now;
  for (let frame = 0; frame < 30; frame++) clock.advance(1 / 60);
  clock.observe(10.5);
  expect(clock.now - even).toBeGreaterThan(.4);
  expect(clock.now - even).toBeLessThan(.6);
});

test('a world that stops brings the clock to rest', () => {
  const clock = new WorldClock(5);
  for (let beat = 0; beat < 60; beat++) {
    for (let frame = 0; frame < 15; frame++) clock.advance(1 / 60);
    clock.observe(5);
  }
  expect(clock.now).toBeCloseTo(5, 1);
});

test('jitter in the beat never drags a steady clock backwards more than a moment', () => {
  const clock = new WorldClock(0);
  const arrivals = [.24, .27, .25, .23, .26, .5, .25, .24, .26, .25];
  let world = 0;
  let last = clock.now;
  let worst = 0;
  for (let round = 0; round < 8; round++) {
    for (const arrival of arrivals) {
      for (let frame = 0; frame < Math.round(arrival * 60); frame++) clock.advance(1 / 60);
      world += arrival;
      clock.observe(world);
      worst = Math.min(worst, clock.now - last);
      last = clock.now;
    }
  }
  expect(worst).toBeGreaterThan(-.01);
});

test('a long absence resets the clock rather than crawling back to the world', () => {
  const clock = new WorldClock(0);
  clock.advance(600);
  clock.observe(12);
  expect(clock.now).toBe(12);
});
