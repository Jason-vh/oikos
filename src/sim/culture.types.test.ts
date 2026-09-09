import { describe, expect, test } from 'bun:test';
import { BUILDINGS, ELITE_TIERS, HOUSE_TIERS } from './buildings';
import { WALKER_SERVICE } from './walkers';
import { TICKS_PER_MONTH } from './time';
import { World } from './world';

describe('the three kinds of culture', () => {
  test('each has its own walker', () => {
    expect(WALKER_SERVICE.philosopher).toBe('culture');
    expect(WALKER_SERVICE.athlete).toBe('athletics');
    expect(WALKER_SERVICE.actor).toBe('drama');
  });

  test('housing asks for one, then two, then three', () => {
    const types = (needs: string[]) => needs.filter((need) => ['culture', 'athletics', 'drama'].includes(need)).length;

    expect(types(HOUSE_TIERS[2].needs)).toBe(0);
    expect(types(HOUSE_TIERS[3].needs)).toBe(1);
    expect(types(HOUSE_TIERS[6].needs)).toBe(3);
    expect(types(ELITE_TIERS[3].needs)).toBe(3);
  });

  test('an actor is trained at a school and performs at a theatre', () => {
    expect(BUILDINGS.dramaSchool.workers).toBeGreaterThan(0);
    expect(BUILDINGS.theatre.size).toBe(4);
    expect(BUILDINGS.theatre.appeal.initial).toBe(10);
  });
});

describe('the stadium', () => {
  test('counts every house in the city as athletic while it is manned', () => {
    const world = new World(28, 7);
    for (let x = 1; x < 27; x++) world.grid.road[world.grid.index(x, 10)] = 1;
    world.treasury = 20000;

    expect(world.place('palace', 3, 11)).toBe(true);
    expect(world.place('house', 16, 11)).toBe(true);
    expect(world.place('stadium', 9, 11)).toBe(true);

    const house = [...world.buildings.values()].find((building) => building.kind === 'house')!;
    const stadium = [...world.buildings.values()].find((building) => building.kind === 'stadium')!;
    house.population = 8;
    stadium.staff = 45;

    expect(house.supply.athletics).toBe(0);
    for (let tick = 0; tick < TICKS_PER_MONTH; tick++) world.update();

    expect(house.supply.athletics).toBeGreaterThan(0);
  });
});
