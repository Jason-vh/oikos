import { describe, expect, test } from 'bun:test';
import { BUILDINGS } from '../sim/buildings';
import { createBuilding } from '../sim/types';
import type { BuildingKind } from '../sim/types';
import { World } from '../sim/world';
import { describeBuildingTool, inspectTile } from './inspect';

function cityWith(kind: BuildingKind, x = 4, y = 4): World {
  const world = new World(24, 5);
  for (let tile = 0; tile < world.grid.road.length; tile++) world.grid.terrain[tile] = 0;
  world.restore(createBuilding(1, kind, x, y, BUILDINGS[kind].size));
  world.settle();
  return world;
}

const factsOf = (world: World, x: number, y: number) => new Map(inspectTile(world, x, y)!.facts);

describe('inspecting the city', () => {
  test('reads a building out with its staffing and stock', () => {
    const world = cityWith('granary');
    world.buildings.get(1)!.stock = 7;
    const facts = factsOf(world, 4, 4);

    expect(inspectTile(world, 4, 4)?.title).toBe('Granary');
    expect(facts.get('Stored')).toBe('7 cartloads');
    expect(facts.get('Workers')).toBe('0 of 18 — 18 short');
  });

  test('says what a house needs to grow', () => {
    const world = cityWith('house');
    const facts = factsOf(world, 4, 4);

    expect(inspectTile(world, 4, 4)?.title).toBe('Shack');
    expect(facts.get('Water')).toBe('none');
    expect(facts.get('Becomes a hovel')).toBe('with water');
  });

  test('reports the walker a service building sends', () => {
    const facts = factsOf(cityWith('fountain'), 4, 4);

    expect(facts.get('Water carrier')).toBe('roams 27 tiles');
    expect(facts.get('Out now')).toBe('0 of 1');
  });

  test('describes bare ground and roads too', () => {
    const world = cityWith('house');
    world.grid.road[world.grid.index(9, 9)] = 1;

    expect(inspectTile(world, 9, 9)?.title).toBe('Road');
    expect(inspectTile(world, 12, 12)?.subtitle).toBe('Ground');
    expect(inspectTile(world, -1, 0)).toBeNull();
  });

  test('a build button explains cost, ground and appeal before anything is placed', () => {
    const wheatFarm = describeBuildingTool('wheatFarm');

    expect(new Map(wheatFarm.facts).get('Ground')).toBe('Meadow only');
    expect(new Map(wheatFarm.facts).get('Appeal')).toBe('-3 -2 -1');
  });
});
