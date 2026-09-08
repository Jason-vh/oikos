import { describe, expect, test } from 'bun:test';
import { appealAt, bandValues, recomputeAppeal } from './appeal';
import type { AppealBands } from './appeal';
import { BUILDINGS, HOUSE_TIERS } from './buildings';
import { Grid } from './grid';
import { emptySupply } from './types';
import type { Building, BuildingKind } from './types';

const bands = (initial: number, bandSize: number, step: number, range: number): AppealBands => ({
  initial,
  bandSize,
  step,
  range,
});

function building(kind: BuildingKind, x: number, y: number, tier = 0): Building {
  return {
    id: 1,
    kind,
    x,
    y,
    size: BUILDINGS[kind].size,
    tier,
    population: 0,
    supply: emptySupply(),
    stock: 0,
    productionProgress: 0,
    spawnTimer: 0,
    walkerOut: false,
  };
}

describe('band model', () => {
  test('flower garden 8,1,-1,3 falls one per ring', () => {
    expect(bandValues(bands(8, 1, -1, 3))).toEqual([8, 7, 6]);
  });

  test('fish pond 18,1,-3,6 falls three per ring', () => {
    expect(bandValues(bands(18, 1, -3, 6))).toEqual([18, 15, 12, 9, 6, 3]);
  });

  test('agora 12,2,-2,6 holds each value for two rings', () => {
    expect(bandValues(bands(12, 2, -2, 6))).toEqual([12, 12, 10, 10, 8, 8]);
  });

  test('college penalty grows with distance', () => {
    expect(bandValues(bands(-5, 1, -3, 3))).toEqual([-5, -8, -11]);
  });

  test('nothing reaches the building itself or beyond its range', () => {
    const garden = bands(8, 1, -1, 3);
    expect(appealAt(garden, 0)).toBe(0);
    expect(appealAt(garden, 4)).toBe(0);
  });
});

describe('appeal field', () => {
  test('rings are measured from the footprint edge, not the origin', () => {
    const grid = new Grid(16);
    const granary = building('granary', 4, 4);
    recomputeAppeal(grid, [granary]);

    const eastward = [6, 7, 8, 9, 10].map((x) => grid.appeal[grid.index(x, 4)]);
    expect(eastward).toEqual([-12, -10, -8, -6, 0]);
  });

  test('overlapping buildings sum', () => {
    const grid = new Grid(16);
    recomputeAppeal(grid, [building('statue', 4, 4), building('fountain', 6, 4)]);

    expect(grid.appeal[grid.index(5, 4)]).toBe(12);
  });

  test('a house drags its own block down until it evolves', () => {
    const grid = new Grid(16);
    recomputeAppeal(grid, [building('house', 4, 4, 0)]);
    expect(grid.appeal[grid.index(5, 4)]).toBe(HOUSE_TIERS[0].appeal.initial);

    recomputeAppeal(grid, [building('house', 4, 4, HOUSE_TIERS.length - 1)]);
    expect(grid.appeal[grid.index(5, 4)]).toBe(0);
  });
});
