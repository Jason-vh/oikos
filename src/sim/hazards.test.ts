import { describe, expect, test } from 'bun:test';
import { BUILDINGS } from './buildings';
import { RISK_LIMIT, accrueRisk, describeRisk, reassure } from './hazards';
import { createBuilding } from './types';
import type { Building, BuildingKind } from './types';
import { World } from './world';

function building(kind: BuildingKind): Building {
  return createBuilding(1, kind, 4, 4, BUILDINGS[kind].size);
}

describe('risk', () => {
  test('builds up month by month at the rate the building carries', () => {
    const press = building('olivePress');
    for (let month = 0; month < 8; month++) accrueRisk([press], 1, () => 1);

    expect(press.fireRisk).toBe(BUILDINGS.olivePress.fireRisk * 2);
    expect(describeRisk(press)).toBe('some');
  });

  test('a burning press is reported as a fire, a crumbling granary as a collapse', () => {
    const press = building('olivePress');
    press.fireRisk = RISK_LIMIT;
    const granary = building('granary');
    granary.damageRisk = RISK_LIMIT;

    expect(accrueRisk([press, granary], 1, () => 0).map((mishap) => mishap.disaster)).toEqual([
      'fire',
      'collapse',
    ]);
  });

  test('a superintendent wipes both risks clean', () => {
    const house = building('house');
    house.fireRisk = 90;
    house.damageRisk = 60;
    reassure(house);

    expect(describeRisk(house)).toBe('none');
  });
});

describe('a city without maintenance', () => {
  function town(withOffice: boolean): { world: World; houses: Building[] } {
    const world = new World(32, 13);
    for (let x = 2; x < 30; x++) world.grid.road[world.grid.index(x, 8)] = 1;

    let id = 1;
    const place = (kind: BuildingKind, x: number, y: number): Building => {
      const building = createBuilding(id++, kind, x, y, BUILDINGS[kind].size);
      world.restore(building);
      return building;
    };

    const houses = [10, 12, 14, 16].map((x) => {
      const house = place('house', x, 7);
      house.population = 40;
      return house;
    });
    if (withOffice) place('maintenanceOffice', 12, 9);

    world.settle();
    return { world, houses };
  }

  test('burns down, while one with a superintendent does not', () => {
    const neglected = town(false);
    for (let tick = 0; tick < 80 * 1200; tick++) neglected.world.update();

    const tended = town(true);
    for (let tick = 0; tick < 80 * 1200; tick++) tended.world.update();

    expect(neglected.world.buildings.size).toBe(0);
    expect(tended.world.buildings.size).toBeGreaterThan(neglected.world.buildings.size);
  });
});
