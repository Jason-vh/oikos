import { describe, expect, test } from 'bun:test';
import { BUILDINGS } from './buildings';
import { FINISHED, createBuilding } from './types';
import { World } from './world';

function city(): World {
  const world = new World(28, 7);
  for (let x = 1; x < 27; x++) world.grid.road[world.grid.index(x, 10)] = 1;
  world.treasury = 20000;

  const quarried = createBuilding(9000, 'masonryShop', 24, 20, 2);
  quarried.stock.marble = 200;
  world.restore(quarried);
  return world;
}

describe('artisans', () => {
  test('a sanctuary goes up unfinished', () => {
    const world = city();
    expect(world.place('sanctuaryDemeter', 3, 11)).toBe(true);

    const sanctuary = [...world.buildings.values()].find((building) => building.kind === 'sanctuaryDemeter')!;
    expect(sanctuary.built).toBe(0);
    expect(BUILDINGS.sanctuaryDemeter.accepts).toEqual(['marble', 'wood']);
  });

  test('an unfinished sanctuary does not count as one', () => {
    const world = city();
    world.place('sanctuaryDemeter', 3, 11);

    expect(world.citySnapshot().sanctuaries).toBe(0);
  });

  test('each visit turns stone into building, and the last one finishes it', () => {
    const world = city();
    world.place('sanctuaryDemeter', 3, 11);
    const sanctuary = [...world.buildings.values()].find((building) => building.kind === 'sanctuaryDemeter')!;

    for (let visit = 0; visit < 40; visit++) {
      sanctuary.stock.marble = 4;
      sanctuary.stock.wood = 4;
      world.raiseSanctuary(sanctuary.id);
    }

    expect(sanctuary.built).toBe(FINISHED);
    expect(world.citySnapshot().sanctuaries).toBe(1);
  });

  test('a visit with nothing in store raises nothing', () => {
    const world = city();
    world.place('sanctuaryDemeter', 3, 11);
    const sanctuary = [...world.buildings.values()].find((building) => building.kind === 'sanctuaryDemeter')!;

    world.raiseSanctuary(sanctuary.id);

    expect(sanctuary.built).toBe(0);
  });
});
