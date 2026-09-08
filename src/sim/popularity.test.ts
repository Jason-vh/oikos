import { describe, expect, test } from 'bun:test';
import { judgeCity, migrantsFor } from './popularity';
import type { CityMood } from './popularity';

const contented: CityMood = {
  wageLevel: 3,
  taxRate: 3,
  fedShare: 1,
  unemployment: 0,
  inDebt: false,
};

describe('popularity', () => {
  test('a fed, employed, fairly taxed city sits above neutral', () => {
    expect(judgeCity(contented).popularity).toBeGreaterThan(50);
    expect(judgeCity(contented).complaint).toBeNull();
  });

  test('hunger, debt, idleness and greed each drag it down', () => {
    const starving = judgeCity({ ...contented, fedShare: 0 });
    const indebted = judgeCity({ ...contented, inDebt: true });
    const idle = judgeCity({ ...contented, unemployment: 0.6 });
    const greedy = judgeCity({ ...contented, taxRate: 6, wageLevel: 0 });

    for (const sentiment of [starving, indebted, idle, greedy]) {
      expect(sentiment.popularity).toBeLessThan(judgeCity(contented).popularity);
      expect(sentiment.complaint).not.toBeNull();
    }
    expect(starving.complaint).toContain('food');
    expect(idle.complaint).toContain('work');
  });

  test('it never leaves the 0 to 100 scale', () => {
    const wretched = judgeCity({ wageLevel: 0, taxRate: 6, fedShare: 0, unemployment: 1, inDebt: true });
    const blessed = judgeCity({ wageLevel: 5, taxRate: 0, fedShare: 1, unemployment: 0, inDebt: false });

    expect(wretched.popularity).toBe(0);
    expect(blessed.popularity).toBeLessThanOrEqual(100);
  });
});

describe('migration', () => {
  test('a well-liked city fills its empty rooms', () => {
    expect(migrantsFor(75, 100, 200)).toBeGreaterThan(0);
    expect(migrantsFor(75, 0, 200)).toBe(0);
  });

  test('an indifferent city trickles', () => {
    expect(migrantsFor(45, 100, 200)).toBe(1);
  });

  test('a hated city empties, whether or not it has room', () => {
    expect(migrantsFor(10, 100, 400)).toBeLessThan(0);
    expect(migrantsFor(10, 0, 400)).toBeLessThan(0);
  });
});
