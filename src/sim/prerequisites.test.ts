import { describe, expect, test } from 'bun:test';
import { BUILDINGS } from './buildings';
import { World } from './world';

function city(): World {
  const world = new World(24, 7);
  for (let x = 1; x < 23; x++) world.grid.road[world.grid.index(x, 6)] = 1;
  world.treasury = 1000;
  return world;
}

describe('prerequisites', () => {
  test('a tax office waits for the palace', () => {
    const world = city();

    expect(world.canPlace('taxOffice', 4, 7)).toEqual({
      ok: false,
      reason: 'Not until a palace stands',
    });

    expect(world.place('palace', 10, 7)).toBe(true);
    expect(world.canPlace('taxOffice', 4, 7).ok).toBe(true);
  });

  test('only the works of rule wait on the palace', () => {
    const gated = Object.values(BUILDINGS).filter((def) => def.requires !== null);

    expect(gated.map((def) => def.kind).sort()).toEqual([
      'heroHall',
      'hippodrome',
      'stadium',
      'taxOffice',
      'tower',
    ]);
    expect(gated.every((def) => def.requires === 'palace')).toBe(true);
  });

  test('the palace lifts appeal across six rings', () => {
    const world = city();
    world.place('palace', 8, 7);
    world.settle();

    const { grid } = world;
    expect(grid.appeal[grid.index(12, 8)]).toBe(18);
    expect(grid.appeal[grid.index(15, 8)]).toBe(15);
    expect(grid.appeal[grid.index(18, 8)]).toBe(0);
  });
});
