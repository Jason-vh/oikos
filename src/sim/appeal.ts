import { BUILDINGS, isDwelling, tierOf } from './buildings';
import type { Grid } from './grid';
import type { Building } from './types';

export interface AppealBands {
  initial: number;
  bandSize: number;
  step: number;
  range: number;
}

export function appealAt(bands: AppealBands, distance: number): number {
  if (distance < 1 || distance > bands.range) return 0;
  return bands.initial + bands.step * Math.floor((distance - 1) / bands.bandSize);
}

export function bandValues(bands: AppealBands): number[] {
  const values: number[] = [];
  for (let distance = 1; distance <= bands.range; distance++) values.push(appealAt(bands, distance));
  return values;
}

export function appealOf(building: Building): AppealBands {
  if (isDwelling(building.kind)) return tierOf(building).appeal;
  return BUILDINGS[building.kind].appeal;
}

export function recomputeAppeal(grid: Grid, buildings: Iterable<Building>): void {
  grid.appeal.fill(0);
  for (const building of buildings) applyBands(grid, building, appealOf(building));
}

function applyBands(grid: Grid, building: Building, bands: AppealBands): void {
  if (bands.range === 0) return;

  const minX = building.x - bands.range;
  const minY = building.y - bands.range;
  const maxX = building.x + building.size - 1 + bands.range;
  const maxY = building.y + building.size - 1 + bands.range;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!grid.contains(x, y)) continue;
      const value = appealAt(bands, ringDistance(building, x, y));
      if (value !== 0) grid.appeal[grid.index(x, y)] += value;
    }
  }
}

function ringDistance(building: Building, x: number, y: number): number {
  const dx = Math.max(building.x - x, 0, x - (building.x + building.size - 1));
  const dy = Math.max(building.y - y, 0, y - (building.y + building.size - 1));
  return Math.max(dx, dy);
}
