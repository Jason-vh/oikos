import { describe, expect, test } from 'bun:test';
import { AFFLICTION_LIMIT, accrueAfflictions, plagueToll, tendHouse, theftLoss } from './unrest';
import { createBuilding } from './types';
import type { Building } from './types';

function hut(population = 8): Building {
  const house = createBuilding(1, 'house', 0, 0, 2);
  house.population = population;
  return house;
}

describe('plague and crime', () => {
  test('a hut sickens faster than a townhouse', () => {
    const bottom = hut();
    const top = hut();
    top.tier = 6;

    accrueAfflictions([bottom, top], () => 1);

    expect(bottom.disease).toBe(10);
    expect(top.disease).toBe(2);
  });

  test('nobles suppress crime instead of breeding it', () => {
    const residence = createBuilding(2, 'estate', 0, 0, 4);
    residence.crime = 50;

    accrueAfflictions([residence], () => 1);

    expect(residence.crime).toBe(30);
    expect(residence.disease).toBe(0);
  });

  test('a doctor and a watchman wipe the slate', () => {
    const house = hut();
    house.disease = 90;
    house.crime = 90;
    house.supply.health = 40;
    house.supply.safety = 40;

    tendHouse(house);

    expect(house.disease).toBe(0);
    expect(house.crime).toBe(0);
  });

  test('an untended house breaks out, and the toll is a third of it', () => {
    const house = hut(9);
    house.disease = AFFLICTION_LIMIT - 5;

    const outbreaks = accrueAfflictions([house], () => 0);

    expect(outbreaks).toEqual([{ house, affliction: 'plague' }]);
    expect(plagueToll(house)).toBe(3);
  });

  test('theft costs what the house would have paid in tax', () => {
    const house = hut(10);

    expect(theftLoss(house)).toBe(10);
  });
});
