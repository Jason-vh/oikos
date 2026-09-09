import { WAGE_LEVELS } from './labour';
import { TAX_RATES } from './taxation';

export interface CityMood {
  wageLevel: number;
  taxRate: number;
  fedShare: number;
  unemployment: number;
  inDebt: boolean;
}

export interface Sentiment {
  popularity: number;
  complaint: string | null;
}

const NEUTRAL = 50;
const TOLERATED_UNEMPLOYMENT = 0.15;
const IDLE_PENALTY_CAP = 25;
const SETTLING_POPULARITY = 55;
const LEAVING_POPULARITY = 35;

export function judgeCity(mood: CityMood): Sentiment {
  const wages = (mood.wageLevel - middle(WAGE_LEVELS.length)) * 6;
  const taxes = (middle(TAX_RATES.length) - mood.taxRate) * 2.3;
  const food = -25 + 40 * mood.fedShare;
  const idle = -Math.min(IDLE_PENALTY_CAP, Math.max(0, mood.unemployment - TOLERATED_UNEMPLOYMENT) * 40);
  const debt = mood.inDebt ? -20 : 0;

  const popularity = clamp(NEUTRAL + wages + taxes + food + idle + debt);
  return { popularity, complaint: complaintOf({ wages, taxes, food, idle, debt }) };
}

export function migrantsFor(popularity: number, freeCapacity: number, population: number): number {
  if (popularity >= SETTLING_POPULARITY) {
    const eager = Math.ceil((freeCapacity * (popularity - SETTLING_POPULARITY + 10)) / 100);
    return Math.min(freeCapacity, eager);
  }
  if (popularity > LEAVING_POPULARITY) return Math.min(freeCapacity, 1);
  return -Math.ceil((population * (LEAVING_POPULARITY - popularity)) / 400);
}

function complaintOf(scores: Record<string, number>): string | null {
  const complaints: Record<string, string> = {
    wages: 'The wages are a disgrace, Archon.',
    taxes: 'The taxes are crushing us, Archon.',
    food: 'There is not enough food in the city, Archon.',
    idle: 'Too many citizens have no work, Archon.',
    debt: 'The city is living on debt, Archon.',
  };

  let worst: string | null = null;
  let lowest = -5;
  for (const [name, score] of Object.entries(scores)) {
    if (score >= lowest) continue;
    lowest = score;
    worst = complaints[name];
  }
  return worst;
}

function middle(count: number): number {
  return Math.floor(count / 2);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
