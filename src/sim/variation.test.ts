import { describe, expect, test } from 'bun:test';
import { appetitePerResident, farmGrowSeconds, thirstPerSecond, walkerPace, wearPerSecond } from './variation';
import {
  CONDITION_DECAY_PER_SECOND,
  FARM_GROW_SECONDS,
  FARM_GROW_SPREAD,
  FOOD_CONSUMPTION_PER_RESIDENT,
  HOUSEHOLD_SPREAD,
  WALKER_PACE_SPREAD,
  WATER_DECAY_PER_SECOND,
  WEAR_SPREAD,
  walkerSpeed,
} from './balance';
import type { Building, BuildingKind, Walker, WalkerKind } from './types';

function buildingWithId(id: number, kind: BuildingKind): Building {
  return {
    id,
    x: 10,
    z: 10,
    kind,
    rotation: 0,
    tier: 1,
    residents: 0,
    food: 0,
    water: 0,
    condition: 100,
    stores: {},
    progress: 0,
    workers: 0,
    vendorEnabled: false,
    vendorInstalled: false,
    connected: true,
    serviceTimer: 0,
    upgradeTimer: 0,
  };
}

function walkerWithId(id: number, kind: WalkerKind): Pick<Walker, 'id' | 'kind'> {
  return { id, kind };
}

const IDS = Array.from({ length: 64 }, (_, index) => index + 1);

function expectSpread(values: readonly number[], base: number, spread: number): void {
  expect(new Set(values).size).toBe(values.length);
  expect(Math.min(...values)).toBeGreaterThanOrEqual(base * (1 - spread / 2));
  expect(Math.max(...values)).toBeLessThanOrEqual(base * (1 + spread / 2));
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  expect(mean / base).toBeCloseTo(1, 1);
}

describe('per-entity variation', () => {
  test('farms grow at their own pace', () => {
    const cycles = IDS.map((id) => farmGrowSeconds(buildingWithId(id, 'farm')));
    expectSpread(cycles, FARM_GROW_SECONDS, FARM_GROW_SPREAD);
  });

  test('walkers of one kind keep their own pace, and kinds stay ordered', () => {
    const paces = IDS.map((id) => walkerPace(walkerWithId(id, 'vendor')));
    expectSpread(paces, walkerSpeed('vendor'), WALKER_PACE_SPREAD);
    expect(Math.max(...IDS.map((id) => walkerPace(walkerWithId(id, 'cart'))))).toBeLessThan(Math.min(...paces));
  });

  test('houses wear, eat and drink at their own rates', () => {
    expectSpread(IDS.map((id) => wearPerSecond(buildingWithId(id, 'house'))), CONDITION_DECAY_PER_SECOND, WEAR_SPREAD);
    expectSpread(IDS.map((id) => appetitePerResident(buildingWithId(id, 'house'))), FOOD_CONSUMPTION_PER_RESIDENT, HOUSEHOLD_SPREAD);
    expectSpread(IDS.map((id) => thirstPerSecond(buildingWithId(id, 'house'))), WATER_DECAY_PER_SECOND, HOUSEHOLD_SPREAD);
  });

  test('traits of one entity are independent of each other and stable', () => {
    const house = buildingWithId(21, 'house');
    expect(wearPerSecond(house) / CONDITION_DECAY_PER_SECOND).not.toBeCloseTo(appetitePerResident(house) / FOOD_CONSUMPTION_PER_RESIDENT, 6);
    expect(appetitePerResident(house) / FOOD_CONSUMPTION_PER_RESIDENT).not.toBeCloseTo(thirstPerSecond(house) / WATER_DECAY_PER_SECOND, 6);
    expect(wearPerSecond(house)).toBe(wearPerSecond(buildingWithId(21, 'house')));
  });
});
