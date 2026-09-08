import { HOUSE_TIERS } from './buildings';
import type { Invasion } from './military';
import type { Good } from './types';

export type Goal =
  | { kind: 'population'; target: number }
  | { kind: 'treasury'; target: number }
  | { kind: 'housing'; tier: number; target: number }
  | { kind: 'production'; good: Good; target: number };

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
}

export interface GoalProgress {
  label: string;
  current: number;
  target: number;
  met: boolean;
}

export const DEFAULT_SCENARIO: Scenario = {
  name: 'The Founding of Thebes',
  blurb: 'Zeus has granted you a valley. Fill it, feed it, and make it worth living in.',
  goals: [
    { kind: 'population', target: 400 },
    { kind: 'housing', tier: HOUSE_TIERS.findIndex((tier) => tier.name === 'Homestead'), target: 150 },
    { kind: 'production', good: 'oil', target: 6 },
    { kind: 'treasury', target: 3000 },
  ],
  invasions: [
    { year: -494, nation: 'Thessalians', companies: 2 },
    { year: -490, nation: 'Trojans', companies: 5 },
    { year: -485, nation: 'Persians', companies: 9 },
  ],
};

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
  return city.peopleByTier.slice(goal.tier).reduce((people, count) => people + count, 0);
}

function labelOf(goal: Goal): string {
  if (goal.kind === 'population') return 'Citizens';
  if (goal.kind === 'treasury') return 'Treasury';
  if (goal.kind === 'production') return `${goal.good === 'oil' ? 'Oil' : 'Wheat'} a year`;
  return `Citizens in a ${HOUSE_TIERS[goal.tier].name.toLowerCase()} or better`;
}
