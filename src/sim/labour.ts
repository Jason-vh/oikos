import { BUILDINGS, LABOUR_PRIORITY } from './buildings';
import type { Building } from './types';

export interface WageLevel {
  name: string;
  workerShare: number;
  drachmasPerWorkerPerYear: number;
}

export const WAGE_LEVELS: WageLevel[] = [
  { name: 'None', workerShare: 0.37, drachmasPerWorkerPerYear: 0 },
  { name: 'Very low', workerShare: 0.41, drachmasPerWorkerPerYear: 2 },
  { name: 'Low', workerShare: 0.44, drachmasPerWorkerPerYear: 2.5 },
  { name: 'Normal', workerShare: 0.47, drachmasPerWorkerPerYear: 3 },
  { name: 'High', workerShare: 0.5, drachmasPerWorkerPerYear: 3.4 },
  { name: 'Very high', workerShare: 0.52, drachmasPerWorkerPerYear: 4 },
];

export const DEFAULT_WAGE_LEVEL = 3;

export interface LabourReport {
  workforce: number;
  employed: number;
  required: number;
}

export function workforceOf(population: number, wageLevel: number): number {
  return Math.floor(population * WAGE_LEVELS[wageLevel].workerShare);
}

export function allocateLabour(buildings: Iterable<Building>, workforce: number): LabourReport {
  const queue = [...buildings].sort(byPriorityThenAge);
  let available = workforce;
  let employed = 0;
  let required = 0;

  for (const building of queue) {
    const needed = BUILDINGS[building.kind].workers;
    building.staff = Math.min(needed, available);
    available -= building.staff;
    employed += building.staff;
    required += needed;
  }

  return { workforce, employed, required };
}

export function staffing(building: Building): number {
  const needed = BUILDINGS[building.kind].workers;
  if (needed === 0) return 1;
  return building.staff / needed;
}

export function monthlyWages(employed: number, wageLevel: number): number {
  return (employed * WAGE_LEVELS[wageLevel].drachmasPerWorkerPerYear) / 12;
}

function byPriorityThenAge(a: Building, b: Building): number {
  const priority = LABOUR_PRIORITY.indexOf(a.kind) - LABOUR_PRIORITY.indexOf(b.kind);
  if (priority !== 0) return priority;
  return a.id - b.id;
}
