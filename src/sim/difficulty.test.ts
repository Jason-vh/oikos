import { describe, expect, test } from 'bun:test';
import { BUILDINGS } from './buildings';
import { DIFFICULTIES, costAt } from './difficulty';
import { workforceOf } from './labour';
import { collectTax } from './taxation';
import { createBuilding } from './types';
import { World } from './world';

describe('difficulty', () => {
  test('scales what a building costs to put up', () => {
    expect(costAt(BUILDINGS.granary.cost, 0)).toBe(60);
    expect(costAt(BUILDINGS.granary.cost, 1)).toBe(90);
    expect(costAt(BUILDINGS.granary.cost, 4)).toBe(180);
  });

  test('scales how many citizens will work', () => {
    expect(workforceOf(100, 3, 0)).toBe(52);
    expect(workforceOf(100, 3, 1)).toBe(47);
    expect(workforceOf(100, 3, 4)).toBe(37);
  });

  test('scales what a noble pays in tax', () => {
    const residence = createBuilding(1, 'estate', 0, 0, 4);
    residence.population = 10;
    residence.supply.tax = 1;

    const beginner = collectTax([residence], 3, 0).collected;
    const olympian = collectTax([residence], 3, 4).collected;

    expect(beginner / olympian).toBeCloseTo(DIFFICULTIES[0].eliteTaxMultiplier / DIFFICULTIES[4].eliteTaxMultiplier, 5);
  });

  test('a city charges its own difficulty for a building', () => {
    const world = new World(24, 3);
    world.difficulty = 4;

    expect(world.costOf('granary')).toBe(180);
  });
});
