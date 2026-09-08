import { describe, expect, test } from 'bun:test';
import { HOUSE_TIERS } from './buildings';
import { TAX_RATES, collectTax } from './taxation';
import { createBuilding } from './types';
import type { Building } from './types';

const NORMAL = TAX_RATES.findIndex((rate) => rate.name === 'Normal');

function house(tier: number, population: number, taxed: boolean): Building {
  const building = createBuilding(1, 'house', 0, 0, 1);
  building.tier = tier;
  building.population = population;
  building.supply.tax = taxed ? 100 : 0;
  return building;
}

const tierOf = (name: string) => HOUSE_TIERS.findIndex((tier) => tier.name === name);

describe('taxation', () => {
  test('is people times rate times the tier multiplier', () => {
    const shacks = collectTax([house(tierOf('Shack'), 100, true)], NORMAL);
    const tenements = collectTax([house(tierOf('Tenement'), 100, true)], NORMAL);

    expect(shacks.collected).toBeCloseTo(9, 5);
    expect(tenements.collected).toBeCloseTo(18, 5);
  });

  test('reaches only the houses a clerk has visited', () => {
    const report = collectTax([house(0, 40, true), house(0, 60, false)], NORMAL);

    expect(report).toEqual({ collected: 40 * 0.09, taxedPeople: 40, untaxedPeople: 60 });
  });

  test('collects nothing at all when the rate is none', () => {
    expect(collectTax([house(3, 100, true)], 0).collected).toBe(0);
  });
});
