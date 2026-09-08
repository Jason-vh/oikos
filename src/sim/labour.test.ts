import { describe, expect, test } from 'bun:test';
import { BUILDINGS } from './buildings';
import { WAGE_LEVELS, allocateLabour, monthlyWages, staffing, workforceOf } from './labour';
import { createBuilding } from './types';
import type { Building, BuildingKind } from './types';

let nextId = 1;

function building(kind: BuildingKind): Building {
  return createBuilding(nextId++, kind, 0, 0, BUILDINGS[kind].size);
}

describe('workforce', () => {
  test('only a share of the population works, and the share follows the wage level', () => {
    expect(workforceOf(1000, WAGE_LEVELS.findIndex((level) => level.name === 'None'))).toBe(370);
    expect(workforceOf(1000, WAGE_LEVELS.findIndex((level) => level.name === 'Normal'))).toBe(470);
    expect(workforceOf(1000, WAGE_LEVELS.findIndex((level) => level.name === 'Very high'))).toBe(520);
  });
});

describe('allocation', () => {
  test('a full workforce staffs everything and leaves the rest idle', () => {
    const farm = building('wheatFarm');
    const granary = building('granary');
    const report = allocateLabour([farm, granary], 100);

    expect(farm.staff).toBe(BUILDINGS.wheatFarm.workers);
    expect(granary.staff).toBe(BUILDINGS.granary.workers);
    expect(report).toEqual({ workforce: 100, employed: 28, required: 28 });
  });

  test('scarcity fills buildings in priority order and starves the last', () => {
    const fountain = building('fountain');
    const farm = building('wheatFarm');
    allocateLabour([fountain, farm], 12);

    expect(farm.staff).toBe(10);
    expect(fountain.staff).toBe(2);
  });

  test('an unstaffed building is idle and a half-staffed one runs at half rate', () => {
    const farm = building('wheatFarm');
    allocateLabour([farm], 0);
    expect(staffing(farm)).toBe(0);

    allocateLabour([farm], 5);
    expect(staffing(farm)).toBe(0.5);
  });

  test('buildings that employ nobody always run', () => {
    expect(staffing(building('statue'))).toBe(1);
  });
});

describe('wages', () => {
  test('the monthly bill is a twelfth of the yearly rate per employed worker', () => {
    const normal = WAGE_LEVELS.findIndex((level) => level.name === 'Normal');
    expect(monthlyWages(120, normal)).toBe(30);
    expect(monthlyWages(120, 0)).toBe(0);
  });
});
