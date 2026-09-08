import { tierOf } from './buildings';
import type { Building } from './types';

export const AFFLICTION_LIMIT = 100;

const DISEASE_PER_MONTH = [20, 16, 12, 9, 7, 5, 4];
const ELITE_DISEASE_PER_MONTH = 0;
const CRIME_PER_MONTH = [3, 3, 2, 2, 2, 2, 2];
const ELITE_CRIME_PER_MONTH = -20;

export type Affliction = 'plague' | 'theft';

export interface Outbreak {
  house: Building;
  affliction: Affliction;
}

export function accrueAfflictions(dwellings: Iterable<Building>): Outbreak[] {
  const outbreaks: Outbreak[] = [];

  for (const house of dwellings) {
    const elite = house.kind === 'estate';
    house.disease = clamp(house.disease + (elite ? ELITE_DISEASE_PER_MONTH : DISEASE_PER_MONTH[house.tier]));
    house.crime = clamp(house.crime + (elite ? ELITE_CRIME_PER_MONTH : CRIME_PER_MONTH[house.tier]));

    if (house.disease >= AFFLICTION_LIMIT) outbreaks.push({ house, affliction: 'plague' });
    else if (house.crime >= AFFLICTION_LIMIT) outbreaks.push({ house, affliction: 'theft' });
  }

  return outbreaks;
}

export function tendHouse(house: Building): void {
  if (house.supply.health > 0) house.disease = 0;
  if (house.supply.safety > 0) house.crime = 0;
}

export function plagueToll(house: Building): number {
  return Math.ceil(house.population / 3);
}

export function theftLoss(house: Building): number {
  return tierOf(house).taxMultiplier * house.population;
}

export function describeAffliction(house: Building): string {
  const worst = Math.max(house.disease, house.crime);
  if (worst >= 75) return 'grave';
  if (worst >= 50) return 'serious';
  if (worst >= 25) return 'some';
  return 'none';
}

function clamp(value: number): number {
  return Math.max(0, Math.min(AFFLICTION_LIMIT, value));
}
