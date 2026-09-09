import { describe, expect, test } from 'bun:test';
import { WALL_COST } from './buildings';
import { fightInvasion } from './military';
import { levelGround } from './testing';
import { World } from './world';

function city(): World {
  const world = levelGround(new World(28, 7));
  for (let x = 1; x < 27; x++) world.grid.road[world.grid.index(x, 10)] = 1;
  world.treasury = 20000;
  return world;
}

describe('walls', () => {
  test('go down a tile at a time and cost by the tile', () => {
    const world = city();
    const before = world.treasury;

    expect(world.placeWall(4, 12)).toBe(true);
    expect(world.placeWall(5, 12)).toBe(true);
    expect(world.wallLength).toBe(2);
    expect(world.treasury).toBe(before - 2 * WALL_COST);
  });

  test('take the ground, so nothing else can have it', () => {
    const world = city();
    world.placeWall(4, 12);

    expect(world.grid.isFree(4, 12)).toBe(false);
    expect(world.placeWall(4, 12)).toBe(false);
  });

  test('come down again when demolished', () => {
    const world = city();
    world.placeWall(4, 12);

    expect(world.demolish(4, 12)).toBe(true);
    expect(world.wallLength).toBe(0);
  });

  test('twelve tiles are worth a company against an invader', () => {
    const world = city();
    for (let x = 4; x < 16; x++) world.placeWall(x, 12);

    expect(world.fortification()).toBe(1);

    const invasion = { year: -490, nation: 'Trojans', companies: 1 };
    expect(fightInvasion({ rabble: 0, hoplite: 0, horseman: 0 }, invasion).won).toBe(false);
    expect(fightInvasion({ rabble: 0, hoplite: 0, horseman: 0 }, invasion, world.fortification()).won).toBe(true);
  });

  test('a manned tower is worth two companies', () => {
    const world = city();
    expect(world.place('palace', 3, 11)).toBe(true);
    expect(world.place('tower', 9, 11)).toBe(true);

    expect(world.fortification()).toBe(0);
    [...world.buildings.values()].at(-1)!.staff = 15;
    expect(world.fortification()).toBe(2);
  });
});
