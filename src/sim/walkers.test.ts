import { describe, expect, test } from 'bun:test';
import { Grid } from './grid';
import { bfsRoute, exitTile, nextRoamTile, northOf } from './pathing';
import { createBuilding } from './types';
import { ROAM_RANGE, WALKER_SPEED } from './walkers';
import { World } from './world';

function gridWithRoads(size: number, roads: [number, number][]): Grid {
  const grid = new Grid(size);
  for (const [x, y] of roads) grid.road[grid.index(x, y)] = 1;
  return grid;
}

describe('exit point', () => {
  test('is the first road found clockwise from north of the footprint', () => {
    const grid = gridWithRoads(16, [
      [3, 6],
      [6, 5],
      [5, 3],
    ]);
    const building = createBuilding(1, 'granary', 4, 4, 2);

    expect(exitTile(grid, building)).toBe(grid.index(5, 3));
  });

  test('falls back around the ring: east before south, south before west', () => {
    const westAndEast = gridWithRoads(16, [
      [3, 4],
      [6, 4],
    ]);
    const westAndSouth = gridWithRoads(16, [
      [3, 4],
      [4, 6],
    ]);
    const building = createBuilding(1, 'granary', 4, 4, 2);

    expect(exitTile(westAndEast, building)).toBe(westAndEast.index(6, 4));
    expect(exitTile(westAndSouth, building)).toBe(westAndSouth.index(4, 6));
  });

  test('is nothing when no road touches the building', () => {
    expect(exitTile(new Grid(16), createBuilding(1, 'granary', 4, 4, 2))).toBe(-1);
  });

  test('the tile due north is only an entry when it carries a road', () => {
    const grid = gridWithRoads(16, [[4, 3]]);
    const fountain = createBuilding(1, 'fountain', 4, 4, 1);

    expect(northOf(grid, fountain)).toBe(grid.index(4, 3));
    expect(northOf(new Grid(16), fountain)).toBe(-1);
  });
});

describe('roadblocks', () => {
  const straightRoad = (): Grid => {
    const grid = new Grid(16);
    for (let x = 0; x < 16; x++) grid.road[grid.index(x, 5)] = 1;
    return grid;
  };

  test('turn a roaming walker back', () => {
    const grid = straightRoad();
    grid.roadblock[grid.index(9, 5)] = 1;

    expect(nextRoamTile(grid, grid.index(8, 5), grid.index(7, 5))).toBe(grid.index(7, 5));
  });

  test('let a walker with a destination through', () => {
    const grid = straightRoad();
    grid.roadblock[grid.index(9, 5)] = 1;
    const goal = grid.index(12, 5);

    expect(bfsRoute(grid, grid.index(2, 5), (tile) => tile === goal)).toContain(grid.index(9, 5));
  });

  test('cost drachmas, sit only on roads, and come off with the demolish tool', () => {
    const world = new World(24, 3);
    for (let x = 2; x < 20; x++) world.grid.road[world.grid.index(x, 5)] = 1;

    expect(world.canPlaceRoadblock(4, 6)).toBe(false);
    expect(world.placeRoadblock(4, 5)).toBe(true);
    expect(world.canPlaceRoadblock(4, 5)).toBe(false);

    world.demolish(4, 5);
    expect(world.grid.isRoadblock(world.grid.index(4, 5))).toBe(false);
    expect(world.grid.isRoad(world.grid.index(4, 5))).toBe(true);
  });
});

describe('roaming', () => {
  test('walkers move at the speed of a citizen, 54.4 tiles a month', () => {
    expect(WALKER_SPEED.waterCarrier * 1200).toBeCloseTo(54.4, 5);
  });

  test('a water carrier walks out its range and comes home', () => {
    const world = new World(32, 7);
    for (let x = 2; x < 30; x++) world.grid.road[world.grid.index(x, 5)] = 1;

    const fountain = createBuilding(1, 'fountain', 4, 4, 1);
    world.restore(fountain);
    world.restore({ ...createBuilding(2, 'house', 20, 4, 1), population: 100 });
    world.settle();

    const walked = new Set<number>();
    let returned = false;
    for (let tick = 0; tick < 4000 && (world.walkers.size === 0 || !returned); tick++) {
      world.update();
      for (const walker of world.walkers.values()) {
        walked.add(walker.from);
        if (walker.state === 'returning') returned = true;
      }
    }

    expect(returned).toBe(true);
    expect(walked.size).toBeLessThanOrEqual(ROAM_RANGE.waterCarrier + 1);

    while (world.walkers.size > 0) world.update();
    expect(world.buildings.get(fountain.id)?.walkerOut).toBe(false);
  });
});
