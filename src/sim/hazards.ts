import { BUILDINGS, HOUSE_TIERS } from './buildings';
import { DEFAULT_DIFFICULTY, DIFFICULTIES } from './difficulty';
import type { Building } from './types';

export const RISK_LIMIT = 100;
const RISK_PACE = 0.25;

export type Disaster = 'fire' | 'collapse';

export interface Mishap {
  building: Building;
  disaster: Disaster;
}

export const MISHAP_CHANCE = 0.2;

export function accrueRisk(
  buildings: Iterable<Building>,
  difficulty = DEFAULT_DIFFICULTY,
  random: () => number = Math.random,
): Mishap[] {
  const scale = DIFFICULTIES[difficulty].riskMultiplier * RISK_PACE;
  const mishaps: Mishap[] = [];

  for (const building of buildings) {
    const def = BUILDINGS[building.kind];
    building.fireRisk = Math.min(RISK_LIMIT, building.fireRisk + def.fireRisk * scale);
    building.damageRisk = Math.min(RISK_LIMIT, building.damageRisk + def.damageRisk * scale);

    const disaster = disasterAt(building);
    if (disaster && random() < MISHAP_CHANCE) mishaps.push({ building, disaster });
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
