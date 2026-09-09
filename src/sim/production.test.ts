import { describe, expect, test } from 'bun:test';
import { BUILDINGS } from './buildings';
import { createBuilding } from './types';
import type { Building, BuildingKind } from './types';
import { World } from './world';

function oilTown(): { world: World; lodge: Building; press: Building; agora: Building; house: Building } {
  const world = new World(32, 4);
  for (let x = 2; x < 30; x++) world.grid.road[world.grid.index(x, 8)] = 1;

  const place = (kind: BuildingKind, x: number, y: number, width = BUILDINGS[kind].size, height = width): Building => {
    const building = createBuilding(world.buildings.size + 1, kind, x, y, width, height);
    world.restore(building);
    return building;
  };

  const lodge = place('growersLodge', 3, 9);
  const press = place('olivePress', 7, 9);
  const agora = place('agora', 11, 9, 6, 3);
  agora.stalls = ['food', 'oil', null];
  const house = place('house', 16, 7);
  house.population = 400;

  world.settle();
  return { world, lodge, press, agora, house };
}

describe('the olive chain', () => {
  test('carts olives from the lodge to the press', () => {
    const { world, lodge, press } = oilTown();

    for (let tick = 0; tick < 4000 && press.stock.olives === 0; tick++) world.update();

    expect(press.stock.olives).toBeGreaterThan(0);
    expect(lodge.stock.olives).toBe(0);
  });

  test('presses olives into oil, one cartload at a time', () => {
    const { world, press } = oilTown();
    press.stock.olives = 2;

    for (let tick = 0; tick < 400 && press.stock.oil === 0; tick++) world.update();

    expect(press.stock.oil).toBe(1);
    expect(press.stock.olives).toBe(1);
  });

  test('an idle press makes nothing without olives', () => {
    const { world, press } = oilTown();
    press.stock.olives = 0;
    world.demolish(3, 9);

    for (let tick = 0; tick < 2000; tick++) world.update();

    expect(press.stock.oil).toBe(0);
  });

  test('the agora keeps one peddler per vendor on the road', () => {
    const { world, agora } = oilTown();
    agora.stock.food = 400;
    agora.stock.oil = 400;

    const goods = new Set<string>();
    for (let tick = 0; tick < 1200; tick++) {
      world.update();
      for (const walker of world.walkers.values()) {
        if (walker.kind === 'peddler' && walker.homeId === agora.id) goods.add(walker.good);
      }
    }

    expect([...goods].sort()).toEqual(['food', 'oil']);
  });

  test('oil reaches houses and lets them become apartments', () => {
    const { world, house } = oilTown();
    for (const building of world.buildings.values()) {
      if (building.kind === 'agora') building.stock.oil = 400;
    }

    for (let tick = 0; tick < 3000 && house.supply.oil === 0; tick++) world.update();

    expect(house.supply.oil).toBeGreaterThan(0);
  });
});
