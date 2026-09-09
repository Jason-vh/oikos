import { describe, expect, test } from 'bun:test';
import { recomputeAppeal } from './appeal';
import { BUILDINGS, ELITE_TIERS } from './buildings';
import { TAX_RATES, collectTax } from './taxation';
import { createBuilding } from './types';
import { World } from './world';

function city(): World {
  const world = new World(28, 7);
  for (let x = 1; x < 27; x++) world.grid.road[world.grid.index(x, 10)] = 1;
  world.treasury = 5000;
  return world;
}

describe('elite housing', () => {
  test('refuses ground the nobility would not live on', () => {
    const world = city();

    expect(world.canPlace('estate', 4, 11)).toEqual({
      ok: false,
      reason: `Needs appeal of ${BUILDINGS.estate.minAppeal}, this ground has 0`,
    });
  });

  test('goes up where appeal is high enough', () => {
    const world = city();
    world.grid.appeal[world.grid.index(4, 11)] = 40;

    expect(world.place('estate', 4, 11)).toBe(true);
    const estate = [...world.buildings.values()][0];
    expect(estate.tier).toBe(0);
    expect(estate.width).toBe(4);
  });

  test('a noble pays eighteen times what a hut dweller pays', () => {
    const hut = createBuilding(1, 'house', 0, 0, 2);
    const residence = createBuilding(2, 'estate', 4, 4, 4);
    hut.population = 10;
    residence.population = 10;
    hut.supply.tax = 1;
    residence.supply.tax = 1;

    const report = collectTax([hut, residence], 3);

    expect(report.taxedPeople).toBe(20);
    const rate = TAX_RATES[3].perPersonPerMonth;
    expect(report.collected).toBeCloseTo(10 * rate + 18 * 10 * rate, 5);
  });

  test('lifts appeal further than any common house drags it down', () => {
    const world = city();
    world.grid.appeal[world.grid.index(4, 11)] = 40;
    world.place('estate', 4, 11);
    world.buildingAt(world.grid.index(4, 11))!.population = 4;
    recomputeAppeal(world.grid, world.buildings.values());

    expect(world.grid.appeal[world.grid.index(9, 12)]).toBe(ELITE_TIERS[0].appeal.initial);
  });
});
