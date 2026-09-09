import { describe, expect, test } from 'bun:test';
import { STALL_WORKERS, stallSlots, stallGoods } from './agora';
import { BUILDINGS, UNITS_PER_CARTLOAD } from './buildings';
import { TERRAIN_GRASS } from './grid';
import { workersFor } from './labour';
import { createBuilding } from './types';
import type { Building, BuildingKind, Good } from './types';
import { World } from './world';

const ROAD_ROW = 8;

function town(seed = 11): World {
  const world = new World(32, seed);
  world.grid.terrain.fill(TERRAIN_GRASS);
  world.grid.height.fill(0);
  world.grid.decor.fill(0);
  world.treasury = 5000;
  for (let x = 2; x < 30; x++) world.grid.road[world.grid.index(x, ROAD_ROW)] = 1;
  return world;
}

function restore(world: World, kind: BuildingKind, x: number, y: number): Building {
  const building = createBuilding(world.buildings.size + 1, kind, x, y, BUILDINGS[kind].size);
  world.restore(building);
  return building;
}

function marketTown(vendors: Good[] = ['food']): {
  world: World;
  granary: Building;
  agora: Building;
  houses: Building[];
} {
  const world = town();
  const granary = restore(world, 'granary', 4, 9);

  expect(world.place('agora', 8, ROAD_ROW)).toBe(true);
  const agora = [...world.buildings.values()].find((building) => building.kind === 'agora')!;
  vendors.forEach((good, stall) => {
    agora.stalls[stall] = good;
  });

  const houses = [16, 18, 20].map((x) => {
    const house = restore(world, 'house', x, 6);
    house.population = 200;
    return house;
  });

  world.settle();
  return { world, granary, agora, houses };
}

describe('an agora', () => {
  test('is laid along the road it is placed on, three stalls to one side', () => {
    const world = town();

    expect(world.place('agora', 8, ROAD_ROW)).toBe(true);
    const agora = [...world.buildings.values()][0];

    expect([agora.width, agora.height]).toEqual([6, 3]);
    expect(agora.stalls.length).toBe(3);
    expect(stallSlots(agora).every((slot) => slot.y !== ROAD_ROW)).toBe(true);
    expect(world.grid.isRoad(world.grid.index(10, ROAD_ROW))).toBe(true);
  });

  test('turns with the road beneath it', () => {
    const world = town();
    for (let y = 2; y < 30; y++) world.grid.road[world.grid.index(20, y)] = 1;

    expect(world.place('agora', 20, 12)).toBe(true);
    const agora = [...world.buildings.values()][0];

    expect([agora.width, agora.height]).toEqual([3, 6]);
  });

  test('a grand agora straddles the road, three stalls each side', () => {
    const world = town();

    expect(world.place('grandAgora', 8, ROAD_ROW)).toBe(true);
    const agora = [...world.buildings.values()][0];

    expect([agora.width, agora.height]).toEqual([6, 5]);
    expect(agora.stalls.length).toBe(6);
    expect(agora.y).toBe(ROAD_ROW - 2);
    expect(new Set(stallSlots(agora).map((slot) => slot.y)).size).toBe(2);
  });

  test('cannot be laid where no road runs', () => {
    const world = town();

    expect(world.canPlace('agora', 8, 20).ok).toBe(false);
    expect(world.place('agora', 8, 20)).toBe(false);
  });

  test('takes a vendor on a free stall, and only there', () => {
    const { world, agora } = marketTown([]);
    const slot = stallSlots(agora)[0];

    expect(world.placeVendor('food', slot.x, slot.y)).toBe(true);
    expect(world.placeVendor('oil', slot.x, slot.y)).toBe(false);
    expect(world.placeVendor('oil', agora.x, ROAD_ROW)).toBe(false);
    expect(stallGoods(agora)).toEqual(['food']);
    expect(workersFor(agora)).toBe(STALL_WORKERS);
  });

  test('with no vendor on it sends nobody', () => {
    const { world, granary, houses } = marketTown([]);
    granary.stock.food = 20;

    for (let tick = 0; tick < 3000; tick++) world.update();

    expect(world.walkers.size).toBe(0);
    expect(houses.every((house) => house.supply.food === 0)).toBe(true);
  });

  test('sends a deliveryman who empties a cartload into the stall', () => {
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

  test('sells only what its vendors deal in', () => {
    const { world, agora } = marketTown(['oil']);
    agora.stock.food = 400;
    agora.stock.oil = 400;

    const sold = new Set<string>();
    for (let tick = 0; tick < 1500; tick++) {
      world.update();
      for (const walker of world.walkers.values()) {
        if (walker.kind === 'peddler') sold.add(walker.good);
      }
    }

    expect([...sold]).toEqual(['oil']);
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
