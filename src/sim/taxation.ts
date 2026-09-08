import { isDwelling, tierOf } from './buildings';
import type { Building } from './types';

export interface TaxRate {
  name: string;
  perPersonPerMonth: number;
}

export const TAX_RATES: TaxRate[] = [
  { name: 'None', perPersonPerMonth: 0 },
  { name: 'Very low', perPersonPerMonth: 0.03 },
  { name: 'Low', perPersonPerMonth: 0.07 },
  { name: 'Normal', perPersonPerMonth: 0.09 },
  { name: 'High', perPersonPerMonth: 0.11 },
  { name: 'Very high', perPersonPerMonth: 0.15 },
  { name: 'Outrageous', perPersonPerMonth: 0.2 },
];

export const DEFAULT_TAX_RATE = 3;

export interface TaxReport {
  collected: number;
  taxedPeople: number;
  untaxedPeople: number;
}

export function collectTax(buildings: Iterable<Building>, rate: number): TaxReport {
  const drachmasPerPerson = TAX_RATES[rate].perPersonPerMonth;
  let collected = 0;
  let taxedPeople = 0;
  let untaxedPeople = 0;

  for (const building of buildings) {
    if (!isDwelling(building.kind)) continue;

    if (building.supply.tax <= 0) {
      untaxedPeople += building.population;
      continue;
    }

    taxedPeople += building.population;
    collected += tierOf(building).taxMultiplier * building.population * drachmasPerPerson;
  }

  return { collected, taxedPeople, untaxedPeople };
}
