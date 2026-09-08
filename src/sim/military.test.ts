import { describe, expect, test } from 'bun:test';
import { MAX_COMPANIES, UNITS, companiesIn, fightInvasion, musterArmy, strengthOf } from './military';
import { createBuilding } from './types';
import type { Building } from './types';

function houses(tier: number, count: number): Building[] {
  return Array.from({ length: count }, (_, index) => {
    const house = createBuilding(index + 1, 'house', 0, 0, 2);
    house.tier = tier;
    house.population = 8;
    return house;
  });
}

describe('mustering', () => {
  test('nobody musters without a palace', () => {
    expect(musterArmy(houses(6, 20), false)).toEqual({ rabble: 0, hoplite: 0, horseman: 0 });
  });

  test('townhouses raise rabble, forty-eight soldiers to a company', () => {
    const army = musterArmy(houses(6, 7), true);

    expect(army.rabble).toBe(2);
    expect(musterArmy(houses(6, 3), true).rabble).toBe(0);
  });

  test('mansions raise hoplites and estates horsemen', () => {
    const elite = Array.from({ length: 8 }, (_, index) => {
      const estate = createBuilding(index + 1, 'estate', 0, 0, 4);
      estate.tier = index < 4 ? 1 : 3;
      estate.population = 6;
      return estate;
    });

    const army = musterArmy(elite, true);

    expect(army.hoplite).toBe(0);
    expect(army.horseman).toBe(2);
  });

  test('never fields more than twenty companies', () => {
    expect(companiesIn(musterArmy(houses(6, 200), true))).toBe(MAX_COMPANIES);
  });
});

describe('invasion', () => {
  const invasion = { year: -490, nation: 'Trojans', companies: 4 };

  test('a stronger city throws the invader back', () => {
    const army = { rabble: 0, hoplite: 5, horseman: 0 };

    expect(strengthOf(army)).toBe(5 * UNITS.hoplite.attack * UNITS.hoplite.hitPoints);
    expect(fightInvasion(army, invasion).won).toBe(true);
  });

  test('a weaker city is sacked', () => {
    expect(fightInvasion({ rabble: 2, hoplite: 0, horseman: 0 }, invasion).won).toBe(false);
  });

  test('an undefended city has no chance at all', () => {
    expect(fightInvasion({ rabble: 0, hoplite: 0, horseman: 0 }, invasion).won).toBe(false);
  });
});
