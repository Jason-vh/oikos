import { describe, expect, test } from 'bun:test';
import {
  ALLY_GOODWILL,
  CITIES,
  GIFT_COST,
  GIFT_GOODWILL,
  NEUTRAL_GOODWILL,
  TRIBUTE_PER_YEAR,
  relationOf,
  tradesWithYou,
  tributeFrom,
} from './cities';
import { TICKS_PER_MONTH } from './time';
import { World } from './world';

describe('the world beyond the city', () => {
  test('reads a relationship off the goodwill', () => {
    expect(relationOf(10)).toBe('rival');
    expect(relationOf(NEUTRAL_GOODWILL)).toBe('distant');
    expect(relationOf(ALLY_GOODWILL)).toBe('ally');
    expect(relationOf(90)).toBe('vassal');
  });

  test('only friends trade, and only vassals pay', () => {
    expect(tradesWithYou(NEUTRAL_GOODWILL)).toBe(false);
    expect(tradesWithYou(ALLY_GOODWILL)).toBe(true);
    expect(tributeFrom(ALLY_GOODWILL)).toBe(0);
    expect(tributeFrom(90)).toBe(TRIBUTE_PER_YEAR);
  });
});

describe('a city and its neighbours', () => {
  function city(): World {
    const world = new World(24, 11);
    world.treasury = 5000;
    return world;
  }

  test('starts distant from everyone', () => {
    const world = city();

    expect(world.standing).toBe(NEUTRAL_GOODWILL);
    for (const neighbour of CITIES) expect(relationOf(world.goodwill[neighbour.id])).toBe('distant');
  });

  test('buys goodwill with a gift', () => {
    const world = city();
    const before = world.treasury;

    expect(world.sendGift('corinth')).toBe(true);
    expect(world.goodwill.corinth).toBe(NEUTRAL_GOODWILL + GIFT_GOODWILL);
    expect(world.treasury).toBe(before - GIFT_COST);
  });

  test('cannot gift what it has not got', () => {
    const world = city();
    world.treasury = 10;

    expect(world.sendGift('corinth')).toBe(false);
  });

  test('collects tribute from a vassal once a year', () => {
    const world = city();
    world.goodwill.knossos = 95;
    const before = world.treasury;

    for (let month = 0; month < 12; month++) {
      for (let tick = 0; tick < TICKS_PER_MONTH; tick++) world.update();
    }

    expect(world.treasury).toBeGreaterThanOrEqual(before + TRIBUTE_PER_YEAR);
  });
});
