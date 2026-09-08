import { describe, expect, test } from 'bun:test';
import { BUILDINGS, UNITS_PER_CARTLOAD } from './buildings';
import { createBuilding } from './types';
import type { Building, BuildingKind } from './types';
import { World } from './world';

function marketTown(): { world: World; granary: Building; agora: Building; houses: Building[] } {
  const world = new World(32, 11);
  for (let x = 2; x < 30; x++) world.grid.road[world.grid.index(x, 8)] = 1;

  const place = (kind: BuildingKind, x: number, y: number): Building => {
    const building = createBuilding(world.buildings.size + 1, kind, x, y, BUILDINGS[kind].size);
    world.restore(building);
    return building;
  };

  const granary = place('granary', 4, 9);
  const agora = place('agora', 8, 9);
  const houses = [12, 14, 16].map((x) => {
    const house = place('house', x, 7);
    house.population = 200;
    return house;
  });

  world.settle();
  return { world, granary, agora, houses };
}

describe('agora', () => {
  test('sends a deliveryman who empties a cartload into its stalls', () => {
    const { world, granary, agora } = marketTown();
    granary.stock.food = 6;

    for (let tick = 0; tick < 2000 && agora.stock.food === 0; tick++) world.update();

    expect(agora.stock.food).toBe(UNITS_PER_CARTLOAD);
    expect(granary.stock.food).toBe(5);
  });

  test('sends peddlers who feed the houses they pass', () => {
    const { world, granary, houses } = marketTown();
    granary.stock.food = 20;

    for (let tick = 0; tick < 6000 && houses.some((house) => house.supply.food === 0); tick++) {
      world.update();
    }

    expect(houses.every((house) => house.supply.food > 0)).toBe(true);
  });

  test('a granary on its own feeds nobody', () => {
    const { world, granary, agora, houses } = marketTown();
    granary.stock.food = 20;
    world.demolish(agora.x, agora.y);

    for (let tick = 0; tick < 4000; tick++) world.update();

    expect(houses.every((house) => house.supply.food === 0)).toBe(true);
    expect(granary.stock.food).toBe(20);
  });
});
