import { HOUSE_TIERS } from './buildings';
import type { CityEvent } from './events';
import type { GodKind } from './gods';
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
  events: CityEvent[];
  gods: GodKind[];
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
    gods: ['demeter', 'hermes', 'artemis', 'hephaestus'],
    invasions: [{ year: -494, nation: 'Thessalians', companies: 2 }],
    events: [
      { year: -497, kind: 'gift', city: 'Corinth', reward: 500 },
      { year: -493, kind: 'request', city: 'Mycenae', good: 'food', cartloads: 8, reward: 600, months: 12 },
    ],
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
    gods: ['poseidon', 'hermes', 'dionysus', 'demeter', 'hades'],
    invasions: [
      { year: -492, nation: 'Thessalians', companies: 3 },
      { year: -487, nation: 'Trojans', companies: 6 },
    ],
    events: [
      { year: -495, kind: 'request', city: 'Knossos', good: 'oil', cartloads: 10, reward: 900, months: 12 },
      { year: -489, kind: 'earthquake', city: 'Corinth' },
      { year: -486, kind: 'monster', city: 'Corinth', monster: 'Medusa' },
      { year: -484, kind: 'flood', city: 'Corinth' },
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
    gods: ['apollo', 'athena', 'zeus', 'aphrodite', 'demeter', 'hades'],
    invasions: [
      { year: -490, nation: 'Persians', companies: 5 },
      { year: -486, nation: 'Persians', companies: 9 },
    ],
    events: [
      { year: -494, kind: 'request', city: 'Troy', good: 'oil', cartloads: 14, reward: 1200, months: 10 },
      { year: -488, kind: 'gift', city: 'Delphi', reward: 1500 },
      { year: -485, kind: 'monster', city: 'Delphi', monster: 'Cerberus' },
      { year: -483, kind: 'landslide', city: 'Delphi' },
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
    gods: ['ares', 'athena', 'zeus', 'hephaestus', 'demeter', 'hermes'],
    invasions: [
      { year: -493, nation: 'Trojans', companies: 6 },
      { year: -489, nation: 'Persians', companies: 12 },
      { year: -484, nation: 'Persians', companies: 18 },
    ],
    events: [
      { year: -496, kind: 'request', city: 'Corinth', good: 'food', cartloads: 16, reward: 1400, months: 12 },
      { year: -491, kind: 'earthquake', city: 'Mycenae' },
      { year: -486, kind: 'gift', city: 'Knossos', reward: 2000 },
      { year: -483, kind: 'monster', city: 'Mycenae', monster: 'Hector' },
      { year: -481, kind: 'lava', city: 'Mycenae' },
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
