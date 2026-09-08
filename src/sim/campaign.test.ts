import { describe, expect, test } from 'bun:test';
import { CAMPAIGN } from './scenario';
import { TICKS_PER_MONTH } from './time';
import { World } from './world';

function city(): World {
  const world = new World(24, 11);
  world.treasury = 1000;
  return world;
}

describe('the campaign', () => {
  test('starts on the first episode and knows there is another', () => {
    const world = city();

    expect(world.episode).toBe(0);
    expect(world.scenario).toBe(CAMPAIGN[0]);
    expect(world.hasNextEpisode).toBe(true);
  });

  test('moves on with the goals of the next city', () => {
    const world = city();
    world.scenarioWon = true;

    world.beginEpisode(1);

    expect(world.scenario).toBe(CAMPAIGN[1]);
    expect(world.scenarioWon).toBe(false);
    expect(world.goals.map((goal) => goal.label)).toEqual([
      'Citizens',
      'Oil a year',
      'Trading partners',
      'Treasury',
    ]);
  });

  test('stops at the last episode', () => {
    const world = city();

    world.beginEpisode(CAMPAIGN.length + 5);

    expect(world.episode).toBe(CAMPAIGN.length - 1);
    expect(world.hasNextEpisode).toBe(false);
  });

  test('two years of debt ends a rule', () => {
    const world = city();
    world.treasury = -1;

    for (let month = 0; month < 24; month++) {
      for (let tick = 0; tick < TICKS_PER_MONTH; tick++) world.update();
      world.treasury = -1;
    }

    expect(world.monthsInDebt).toBeGreaterThanOrEqual(24);
    expect(world.scenarioLost).toBe(true);
  });
});
