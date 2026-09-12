import { expect, test } from 'bun:test';
import { islandFacts } from './island-choice';
import { islandFor, nextArchipelagoSeed } from '../sim/island';

test('the preview uses exactly the next archipelago seed', () => {
  expect(nextArchipelagoSeed(1)).toBe(2);
  for (const seed of [2, 8, 37, 0xffffffff]) {
    expect(nextArchipelagoSeed(seed)).toBe((seed * 1103515245 + 12345) % 0x7fffffff);
    expect(Number.isInteger(nextArchipelagoSeed(seed))).toBe(true);
    expect(nextArchipelagoSeed(seed)).toBeGreaterThanOrEqual(0);
  }
});

test('island facts count the actual terrain without changing the shared map', () => {
  const map = islandFor(2);
  const before = [...map.terrain];
  const totals = { land: 0, fertile: 0, forest: 0 };
  for (let home = 0; home < map.islands.length; home++) {
    const facts = islandFacts(map, home);
    expect(facts.land).toBeGreaterThan(0);
    expect(facts.fertile).toBeGreaterThan(0);
    expect(facts.forest).toBeGreaterThan(0);
    totals.land += facts.land;
    totals.fertile += facts.fertile;
    totals.forest += facts.forest;
  }
  expect(totals.land).toBe(map.terrain.filter((terrain) => terrain !== 'water').length);
  expect(totals.fertile).toBe(map.terrain.filter((terrain) => terrain === 'fertile').length);
  expect(totals.forest).toBe(map.terrain.filter((terrain) => terrain === 'forest').length);
  expect(map.terrain).toEqual(before);
  expect(islandFacts(map, -1)).toEqual({ land: 0, fertile: 0, forest: 0 });
});
