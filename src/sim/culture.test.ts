import { describe, expect, test } from 'bun:test';
import { BUILDINGS, HOUSE_TIERS } from './buildings';
import { createBuilding } from './types';
import type { Building, BuildingKind } from './types';
import { World } from './world';

function schoolTown(withPodium = true): { world: World; college: Building; podium?: Building; house: Building } {
  const world = new World(32, 9);
  for (let x = 2; x < 30; x++) world.grid.road[world.grid.index(x, 8)] = 1;

  const place = (kind: BuildingKind, x: number, y: number): Building => {
    const building = createBuilding(world.buildings.size + 1, kind, x, y, BUILDINGS[kind].size);
    world.restore(building);
    return building;
  };

  const college = place('college', 3, 9);
  const podium = withPodium ? place('podium', 9, 9) : undefined;
  const house = place('house', 14, 7);
  house.population = 400;

  world.settle();
  return { world, college, podium, house };
}

describe('culture', () => {
  test('a philosopher walks to the podium, then roams from it', () => {
    const { world, college, podium } = schoolTown();

    const seen = new Set<string>();
    for (let tick = 0; tick < 3000; tick++) {
      world.update();
      for (const walker of world.walkers.values()) {
        if (walker.kind !== 'philosopher') continue;
        seen.add(`${walker.state}:${walker.homeId === podium!.id ? 'podium' : 'college'}`);
      }
    }

    expect(seen.has('delivering:college')).toBe(true);
    expect(seen.has('roaming:podium')).toBe(true);
    expect(college.walkersOut).toBeLessThanOrEqual(BUILDINGS.college.maxWalkers);
  });

  test('he teaches the houses he passes once he is roaming', () => {
    const { world, house } = schoolTown();

    for (let tick = 0; tick < 3000 && house.supply.culture === 0; tick++) world.update();

    expect(house.supply.culture).toBeGreaterThan(0);
  });

  test('a college with nowhere to speak sends nobody out', () => {
    const { world, house } = schoolTown(false);

    for (let tick = 0; tick < 3000; tick++) world.update();

    expect(house.supply.culture).toBe(0);
    expect([...world.walkers.values()].some((walker) => walker.kind === 'philosopher')).toBe(false);
  });

  test('houses stall below a homestead until someone teaches them', () => {
    const { world, house } = schoolTown(false);
    house.supply.water = 100;
    house.supply.food = 100;

    for (let tick = 0; tick < 2000; tick++) {
      house.supply.water = 100;
      house.supply.food = 100;
      world.update();
    }

    expect(HOUSE_TIERS[house.tier].name).toBe('Hovel');
  });
});
