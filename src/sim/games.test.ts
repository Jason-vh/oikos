import { describe, expect, test } from 'bun:test';
import { GAMES, culturedShare, gameOfYear, winsTheGames } from './games';
import { TICKS_PER_MONTH } from './time';
import { createBuilding } from './types';
import { World } from './world';

const served = (culture: Partial<Record<'culture' | 'athletics' | 'drama', number>>) => {
  const house = createBuilding(1, 'house', 0, 0, 2);
  Object.assign(house.supply, culture);
  return house;
};

describe('the games', () => {
  test('come round on a four-year cycle', () => {
    expect(gameOfYear(-500).name).toBe(GAMES[0].name);
    expect(gameOfYear(-499).name).toBe(GAMES[3].name);
    expect(gameOfYear(-496).name).toBe(GAMES[0].name);
    expect(new Set(GAMES.map((game) => game.name)).size).toBe(4);
  });

  test('are won by a city where six houses in ten know the art', () => {
    const houses = [served({ drama: 10 }), served({ drama: 10 }), served({})];

    expect(culturedShare(houses, 'drama')).toBeCloseTo(2 / 3, 5);
    expect(winsTheGames(culturedShare(houses, 'drama'))).toBe(true);
    expect(winsTheGames(culturedShare(houses, 'athletics'))).toBe(false);
  });

  test('the Olympics ask for every art at once', () => {
    expect(culturedShare([served({ culture: 5, athletics: 5, drama: 5 })], 'all')).toBe(1);
    expect(culturedShare([served({ culture: 5, athletics: 5 })], 'all')).toBe(0);
  });
});

describe('a city at the games', () => {
  function city(): World {
    const world = new World(24, 11);
    world.treasury = 5000;
    return world;
  }

  test('pays to enter, and only once', () => {
    const world = city();
    const before = world.treasury;

    expect(world.enterGames()).toBe(true);
    expect(world.treasury).toBe(before - gameOfYear(world.year).entryCost);
    expect(world.enterGames()).toBe(false);
  });

  test('wins a purse and goodwill when its houses are cultured', () => {
    const world = city();
    const house = createBuilding(900, 'house', 4, 4, 2);
    house.supply.culture = 50;
    world.restore(house);
    world.enterGames();
    const before = world.treasury;
    const goodwill = world.goodwill.corinth;

    for (let month = 0; month < 12; month++) {
      house.supply.culture = 50;
      for (let tick = 0; tick < TICKS_PER_MONTH; tick++) world.update();
    }

    expect(world.gamesWon).toBe(1);
    expect(world.treasury).toBeGreaterThan(before);
    expect(world.goodwill.corinth).toBeGreaterThan(goodwill);
  });
});
