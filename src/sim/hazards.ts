import { BUILDINGS, HOUSE_TIERS } from './buildings';
import type { Building } from './types';

export const RISK_LIMIT = 100;

export type Disaster = 'fire' | 'collapse';

export interface Mishap {
  building: Building;
  disaster: Disaster;
}

export function accrueRisk(buildings: Iterable<Building>): Mishap[] {
  const mishaps: Mishap[] = [];

  for (const building of buildings) {
    const def = BUILDINGS[building.kind];
    building.fireRisk += def.fireRisk;
    building.damageRisk += def.damageRisk;

    const disaster = disasterAt(building);
    if (disaster) mishaps.push({ building, disaster });
  }

  return mishaps;
}

export function reassure(building: Building): void {
  building.fireRisk = 0;
  building.damageRisk = 0;
}

export function describeRisk(building: Building): string {
  const risk = Math.max(building.fireRisk, building.damageRisk);
  if (risk >= 75) return 'grave';
  if (risk >= 50) return 'serious';
  if (risk >= 25) return 'some';
  return 'none';
}

export function riskOf(building: Building): number {
  return Math.min(RISK_LIMIT, Math.max(building.fireRisk, building.damageRisk));
}

export function nameOf(building: Building): string {
  if (building.kind === 'house') return HOUSE_TIERS[building.tier].name;
  return BUILDINGS[building.kind].name;
}

function disasterAt(building: Building): Disaster | null {
  if (building.fireRisk >= RISK_LIMIT) return 'fire';
  if (building.damageRisk >= RISK_LIMIT) return 'collapse';
  return null;
}
