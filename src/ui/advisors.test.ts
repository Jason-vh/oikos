import { describe, expect, test } from 'bun:test';
import { levelGround } from '../sim/testing';
import { World } from '../sim/world';
import { adviseCity, ratingsOf } from './advisors';

function city(): World {
  const world = levelGround(new World(28, 7));
  for (let x = 1; x < 27; x++) world.grid.road[world.grid.index(x, 10)] = 1;
  world.treasury = 4000;
  return world;
}

describe('the advisors', () => {
  test('report on the people, the money, the city, the gods and the rating', () => {
    expect(adviseCity(city()).map((report) => report.name)).toEqual([
      'The people',
      'The treasury',
      'The city',
      'The gods',
      'The rating',
    ]);
  });

  test('flag what should worry the archon', () => {
    const world = city();
    world.treasury = -100;

    const treasury = adviseCity(world).find((report) => report.name === 'The treasury')!;
    expect(treasury.readings.find((reading) => reading.label === 'Treasury')?.concern).toBe(true);
  });
});

describe('the rating', () => {
  test('is nought for an empty valley and never above a hundred', () => {
    const empty = ratingsOf(city());
    expect(empty.population).toBe(0);
    expect(empty.monuments).toBe(0);

    const rich = city();
    rich.treasury = 1_000_000;
    expect(ratingsOf(rich).prosperity).toBe(100);
  });
});

describe('undo', () => {
  test('takes back the last building and its cost', () => {
    const world = city();
    const before = world.treasury;

    expect(world.place('granary', 3, 11)).toBe(true);
    expect(world.treasury).toBeLessThan(before);

    expect(world.undoLastBuild()).toBe(true);
    expect(world.treasury).toBe(before);
    expect(world.buildings.size).toBe(0);
    expect(world.undoLastBuild()).toBe(false);
  });
});
