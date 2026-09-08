import { HOUSE_TIERS } from './buildings';
import type { Invasion } from './military';
import type { Good } from './types';

export type Goal =
  | { kind: 'population'; target: number }
  | { kind: 'treasury'; target: number }
  | { kind: 'housing'; tier: number; target: number }
  | { kind: 'production'; good: Good; target: number }
  | { kind: 'sanctuary'; target: number }
  | { kind: 'army'; target: number }
  | { kind: 'trade'; target: number };

export interface Scenario {
  name: string;
  blurb: string;
  goals: Goal[];
  invasions: Invasion[];
}

export interface CitySnapshot {
  population: number;
  treasury: number;
  peopleByTier: number[];
  yearlyOutput: Record<Good, number>;
  sanctuaries: number;
  companies: number;
  tradePartners: number;
}

export interface GoalProgress {
  label: string;
  current: number;
  target: number;
  met: boolean;
}

const homestead = HOUSE_TIERS.findIndex((tier) => tier.name === 'Homestead');
const townhouse = HOUSE_TIERS.findIndex((tier) => tier.name === 'Townhouse');

export const CAMPAIGN: Scenario[] = [
  {
    name: 'The Founding of Thebes',
    blurb: 'Zeus has granted you a valley. Fill it, feed it, and make it worth living in.',
    goals: [
      { kind: 'population', target: 400 },
      { kind: 'housing', tier: homestead, target: 150 },
      { kind: 'production', good: 'oil', target: 6 },
      { kind: 'treasury', target: 3000 },
    ],
    invasions: [{ year: -494, nation: 'Thessalians', companies: 2 }],
  },
  {
    name: 'The Oil of Corinth',
    blurb: 'The presses of Corinth are famous. Make yours richer, and sell to the world.',
    goals: [
      { kind: 'population', target: 900 },
      { kind: 'production', good: 'oil', target: 40 },
      { kind: 'trade', target: 2 },
      { kind: 'treasury', target: 8000 },
    ],
    invasions: [
      { year: -492, nation: 'Thessalians', companies: 3 },
      { year: -487, nation: 'Trojans', companies: 6 },
    ],
  },
  {
    name: 'The Sanctuaries of Delphi',
    blurb: 'Delphi answers to the gods before it answers to you. Honour them, and be honoured.',
    goals: [
      { kind: 'population', target: 1400 },
      { kind: 'sanctuary', target: 3 },
      { kind: 'housing', tier: townhouse, target: 200 },
    ],
    invasions: [
      { year: -490, nation: 'Persians', companies: 5 },
      { year: -486, nation: 'Persians', companies: 9 },
    ],
  },
  {
    name: 'The Walls of Mycenae',
    blurb: 'Mycenae is rich and hated for it. Muster an army before the Persians come.',
    goals: [
      { kind: 'population', target: 2000 },
      { kind: 'army', target: 8 },
      { kind: 'housing', tier: townhouse, target: 400 },
      { kind: 'treasury', target: 15000 },
    ],
    invasions: [
      { year: -493, nation: 'Trojans', companies: 6 },
      { year: -489, nation: 'Persians', companies: 12 },
      { year: -484, nation: 'Persians', companies: 18 },
    ],
  },
];

export const DEFAULT_SCENARIO: Scenario = CAMPAIGN[0];

export function measureGoals(scenario: Scenario, city: CitySnapshot): GoalProgress[] {
  return scenario.goals.map((goal) => {
    const current = currentValue(goal, city);
    return {
      label: labelOf(goal),
      current: Math.floor(current),
      target: goal.target,
      met: current >= goal.target,
    };
  });
}

export function allGoalsMet(progress: GoalProgress[]): boolean {
  return progress.length > 0 && progress.every((goal) => goal.met);
}

function currentValue(goal: Goal, city: CitySnapshot): number {
  if (goal.kind === 'population') return city.population;
  if (goal.kind === 'treasury') return city.treasury;
  if (goal.kind === 'production') return city.yearlyOutput[goal.good];
  if (goal.kind === 'sanctuary') return city.sanctuaries;
  if (goal.kind === 'army') return city.companies;
  if (goal.kind === 'trade') return city.tradePartners;
  return city.peopleByTier.slice(goal.tier).reduce((people, count) => people + count, 0);
}

function labelOf(goal: Goal): string {
  if (goal.kind === 'population') return 'Citizens';
  if (goal.kind === 'treasury') return 'Treasury';
  if (goal.kind === 'production') return `${goal.good === 'oil' ? 'Oil' : 'Wheat'} a year`;
  if (goal.kind === 'sanctuary') return 'Sanctuaries';
  if (goal.kind === 'army') return 'Companies';
  if (goal.kind === 'trade') return 'Trading partners';
  return `Citizens in a ${HOUSE_TIERS[goal.tier].name.toLowerCase()} or better`;
}
