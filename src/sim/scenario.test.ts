import { describe, expect, test } from 'bun:test';
import { HOUSE_TIERS } from './buildings';
import { DEFAULT_SCENARIO, allGoalsMet, measureGoals } from './scenario';
import type { CitySnapshot, Scenario } from './scenario';

const homestead = HOUSE_TIERS.findIndex((tier) => tier.name === 'Homestead');

const city = (over: Partial<CitySnapshot> = {}): CitySnapshot => ({
  population: 0,
  treasury: 0,
  peopleByTier: HOUSE_TIERS.map(() => 0),
  yearlyOutput: { food: 0, olives: 0, oil: 0, grapes: 0, wine: 0, fleece: 0 },
  sanctuaries: 0,
  companies: 0,
  tradePartners: 0,
  ...over,
});

const scenario: Scenario = {
  name: 'Test',
  blurb: '',
  goals: [
    { kind: 'population', target: 100 },
    { kind: 'housing', tier: homestead, target: 50 },
    { kind: 'production', good: 'oil', target: 6 },
  ],
  invasions: [],
  events: [],
  gods: [],
};

describe('goals', () => {
  test('report how far the city has come', () => {
    const progress = measureGoals(scenario, city({ population: 60 }));

    expect(progress[0]).toEqual({ label: 'Citizens', current: 60, target: 100, met: false });
    expect(allGoalsMet(progress)).toBe(false);
  });

  test('count housing at the required tier and above', () => {
    const peopleByTier = HOUSE_TIERS.map(() => 0);
    peopleByTier[homestead] = 30;
    peopleByTier[homestead + 1] = 25;

    expect(measureGoals(scenario, city({ peopleByTier }))[1].current).toBe(55);
  });

  test('ignore production of the wrong good', () => {
    const wheatOnly = measureGoals(scenario, city({ yearlyOutput: { food: 40, olives: 9, oil: 0, grapes: 0, wine: 0, fleece: 0 } }));

    expect(wheatOnly[2].met).toBe(false);
  });

  test('are all met when every one is reached', () => {
    const peopleByTier = HOUSE_TIERS.map(() => 0);
    peopleByTier[homestead] = 200;

    const progress = measureGoals(
      scenario,
      city({ population: 200, peopleByTier, yearlyOutput: { food: 0, olives: 0, oil: 8, grapes: 0, wine: 0, fleece: 0 } }),
    );

    expect(allGoalsMet(progress)).toBe(true);
  });

  test('the shipped scenario asks for people, homes, oil and money', () => {
    expect(DEFAULT_SCENARIO.goals.map((goal) => goal.kind)).toEqual([
      'population',
      'housing',
      'production',
      'treasury',
    ]);
  });
});
