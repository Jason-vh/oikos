import { describe, expect, test } from 'bun:test';
import { BROKEN_PROMISE_STANDING, REQUEST_STANDING, ageRequests, requestFrom } from './events';
import { NEUTRAL_GOODWILL } from './cities';
import { TICKS_PER_MONTH } from './time';
import { World } from './world';

const REQUEST = { city: 'Mycenae', good: 'food' as const, cartloads: 4, monthsLeft: 2, reward: 500 };

describe('requests', () => {
  test('count down and expire', () => {
    const first = ageRequests([REQUEST]);
    expect(first.live[0].monthsLeft).toBe(1);
    expect(first.expired).toEqual([]);

    const second = ageRequests(first.live);
    expect(second.live).toEqual([]);
    expect(second.expired[0].city).toBe('Mycenae');
  });

  test('take their shape from the scenario event', () => {
    expect(requestFrom({ year: -490, kind: 'request', city: 'Troy' })).toEqual({
      city: 'Troy',
      good: 'food',
      cartloads: 8,
      monthsLeft: 12,
      reward: 400,
    });
  });
});

describe('a city and the world', () => {
  function stocked(): World {
    const world = new World(24, 11);
    for (let x = 1; x < 23; x++) world.grid.road[world.grid.index(x, 6)] = 1;
    world.treasury = 5000;
    world.place('granary', 2, 7);
    const granary = [...world.buildings.values()][0];
    granary.stock.food = 10;
    world.requests = [{ ...REQUEST }];
    return world;
  }

  test('sending the goods empties the store, pays and raises standing', () => {
    const world = stocked();
    const before = world.treasury;

    expect(world.fulfilRequest(0)).toBe(true);
    expect(world.requests).toEqual([]);
    expect(world.treasury).toBe(before + REQUEST.reward);
    expect(world.goodwill.mycenae).toBe(NEUTRAL_GOODWILL + REQUEST_STANDING);
    expect([...world.buildings.values()][0].stock.food).toBe(6);
  });

  test('a city with nothing to send cannot promise', () => {
    const world = stocked();
    [...world.buildings.values()][0].stock.food = 1;

    expect(world.fulfilRequest(0)).toBe(false);
    expect(world.requests.length).toBe(1);
  });

  test('a broken promise costs standing', () => {
    const world = stocked();
    world.requests = [{ ...REQUEST, monthsLeft: 1 }];

    for (let tick = 0; tick < TICKS_PER_MONTH; tick++) world.update();

    expect(world.requests).toEqual([]);
    expect(world.goodwill.mycenae).toBe(NEUTRAL_GOODWILL - BROKEN_PROMISE_STANDING);
  });
});
