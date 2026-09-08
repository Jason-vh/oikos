import { BUILDINGS } from './buildings';
import type { Grid } from './grid';
import type { Building } from './types';

export function recomputeDesirability(grid: Grid, buildings: Iterable<Building>): void {
  grid.desirability.fill(0);

  for (const building of buildings) {
    const def = BUILDINGS[building.kind];
    if (def.desirability === 0 || def.desirabilityRange === 0) continue;
    applyInfluence(grid, building, def.desirability, def.desirabilityRange);
  }
}

function applyInfluence(grid: Grid, building: Building, value: number, range: number): void {
  const minX = building.x - range;
  const minY = building.y - range;
  const maxX = building.x + building.size - 1 + range;
  const maxY = building.y + building.size - 1 + range;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!grid.contains(x, y)) continue;
      const distance = footprintDistance(building, x, y);
      if (distance > range) continue;
      const falloff = (range + 1 - distance) / (range + 1);
      grid.desirability[grid.index(x, y)] += Math.round(value * falloff);
    }
  }
}

function footprintDistance(building: Building, x: number, y: number): number {
  const dx = Math.max(building.x - x, 0, x - (building.x + building.size - 1));
  const dy = Math.max(building.y - y, 0, y - (building.y + building.size - 1));
  return Math.max(dx, dy);
}
