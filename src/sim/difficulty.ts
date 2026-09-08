export interface Difficulty {
  name: string;
  costMultiplier: number;
  workerShares: number[];
  eliteTaxMultiplier: number;
  riskMultiplier: number;
  evolveAppealShift: number;
}

export const DIFFICULTIES: Difficulty[] = [
  {
    name: 'Beginner',
    costMultiplier: 1,
    workerShares: [0.42, 0.46, 0.49, 0.52, 0.55, 0.57],
    eliteTaxMultiplier: 22,
    riskMultiplier: 0.7,
    evolveAppealShift: -8,
  },
  {
    name: 'Mortal',
    costMultiplier: 1.5,
    workerShares: [0.37, 0.41, 0.44, 0.47, 0.5, 0.52],
    eliteTaxMultiplier: 18,
    riskMultiplier: 1,
    evolveAppealShift: 0,
  },
  {
    name: 'Hero',
    costMultiplier: 2,
    workerShares: [0.32, 0.36, 0.39, 0.42, 0.45, 0.47],
    eliteTaxMultiplier: 16,
    riskMultiplier: 1.3,
    evolveAppealShift: 6,
  },
  {
    name: 'Titan',
    costMultiplier: 2.5,
    workerShares: [0.29, 0.33, 0.36, 0.39, 0.42, 0.44],
    eliteTaxMultiplier: 14,
    riskMultiplier: 1.6,
    evolveAppealShift: 10,
  },
  {
    name: 'Olympian',
    costMultiplier: 3,
    workerShares: [0.27, 0.31, 0.34, 0.37, 0.4, 0.42],
    eliteTaxMultiplier: 12,
    riskMultiplier: 2,
    evolveAppealShift: 14,
  },
];

export const DEFAULT_DIFFICULTY = 1;

export function costAt(baseCost: number, difficulty: number): number {
  return Math.round(baseCost * DIFFICULTIES[difficulty].costMultiplier);
}
