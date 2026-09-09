import { describe, expect, test } from 'bun:test';
import { isVacantPlot } from './buildings';
import { TERRAIN_GRASS } from './grid';
import { entryPoint } from './mapgen';
import { TICKS_PER_MONTH } from './time';
import type { Building } from './types';
import { World } from './world';

function flatCity(): World {
  const world = new World(32, 5);
  world.grid.terrain.fill(TERRAIN_GRASS);
  world.grid.height.fill(0);
  world.grid.decor.fill(0);
  world.treasury = 20000;
  world.sentiment = { popularity: 90, complaint: null };
  return world;
}

function roadFromEntryTo(world: World, x: number, y: number): void {
  const { grid } = world;
  const entryX = grid.tileX(world.entry);
  const entryY = grid.tileY(world.entry);

  for (let step = Math.min(entryY, y); step <= Math.max(entryY, y); step++) {
    grid.road[grid.index(entryX, step)] = 1;
  }
  for (let step = Math.min(entryX, x); step <= Math.max(entryX, x); step++) {
    grid.road[grid.index(step, y)] = 1;
  }
}

function roadCutOffFromEntry(world: World): void {
  for (let x = 10; x < 20; x++) world.grid.road[world.grid.index(x, 15)] = 1;
}

function run(world: World, ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) world.update();
}

function theHouse(world: World): Building {
  return [...world.buildings.values()].find((building) => building.kind === 'house')!;
}

describe('the entry point', () => {
  test('sits on dry land at the edge of the map, the same every time for a seed', () => {
    const world = new World(32, 11);
    const { grid } = world;
    const x = grid.tileX(world.entry);
    const y = grid.tileY(world.entry);

    expect(x === 0 || y === 0 || x === grid.size - 1 || y === grid.size - 1).toBe(true);
    expect(entryPoint(grid, 11)).toBe(world.entry);
  });
});

describe('immigration', () => {
  test('a new plot stands empty until settlers walk in from the entry point', () => {
    const world = flatCity();
    roadFromEntryTo(world, 15, 15);
    expect(world.place('house', 15, 16)).toBe(true);

    const plot = theHouse(world);
    expect(isVacantPlot(plot)).toBe(true);
    expect(world.population).toBe(0);

    run(world, TICKS_PER_MONTH);
    expect(world.arrivals).toBeGreaterThan(0);

    let sawImmigrant = false;
    for (let tick = 0; tick < TICKS_PER_MONTH * 3 && plot.population === 0; tick++) {
      world.update();
      sawImmigrant ||= [...world.walkers.values()].some((walker) => walker.kind === 'immigrant');
    }

    expect(sawImmigrant).toBe(true);
    expect(plot.population).toBeGreaterThan(0);
    expect(isVacantPlot(plot)).toBe(false);
  });

  test('nobody arrives while no road reaches the entry point', () => {
    const world = flatCity();
    roadCutOffFromEntry(world);
    expect(world.place('house', 15, 16)).toBe(true);

    run(world, TICKS_PER_MONTH * 3);

    expect(world.entryConnected).toBe(false);
    expect(theHouse(world).population).toBe(0);
    expect(world.arrivals).toBeGreaterThan(0);
  });

  test('an empty plot asks nothing of its neighbours and risks nothing', () => {
    const world = flatCity();
    roadCutOffFromEntry(world);
    world.place('house', 15, 16);
    world.settle();

    const plot = theHouse(world);
    const risk = plot.fireRisk;
    run(world, TICKS_PER_MONTH * 3);

    expect(world.grid.appeal[world.grid.index(17, 16)]).toBe(0);
    expect(plot.fireRisk).toBe(risk);
  });

  test('a city losing its people sends them walking back out', () => {
    const world = flatCity();
    roadFromEntryTo(world, 15, 15);
    world.place('house', 15, 16);

    const house = theHouse(world);
    house.tier = 1;
    house.population = 8;
    world.wageLevel = 0;
    world.taxRate = 6;
    world.treasury = -100;
    run(world, TICKS_PER_MONTH);

    expect(house.population).toBeLessThan(8);
    expect([...world.walkers.values()].some((walker) => walker.kind === 'emigrant')).toBe(true);
  });

  test('a house emptied of people falls back to an empty plot', () => {
    const world = flatCity();
    roadFromEntryTo(world, 15, 15);
    world.place('house', 15, 16);

    const house = theHouse(world);
    house.tier = 2;
    house.population = 0;
    run(world, 50);

    expect(house.tier).toBe(0);
    expect(isVacantPlot(house)).toBe(true);
  });
});

describe('a house the settlers cannot reach', () => {
  test('does not hold up the houses they can', () => {
    const world = flatCity();
    roadFromEntryTo(world, 15, 15);
    for (let x = 20; x < 28; x++) world.grid.road[world.grid.index(x, 28)] = 1;

    expect(world.place('house', 24, 29)).toBe(true);
    expect(world.place('house', 15, 16)).toBe(true);
    const [cutOff, onTheRoad] = [...world.buildings.values()];

    run(world, TICKS_PER_MONTH * 3);

    expect(cutOff.population).toBe(0);
    expect(onTheRoad.population).toBeGreaterThan(0);
  });
});
