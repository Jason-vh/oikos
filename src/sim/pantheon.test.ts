import { describe, expect, test } from 'bun:test';
import { BUILDINGS, SANCTUARY_KINDS } from './buildings';
import { BLESSINGS, SILVER_GIFT, WRATHS } from './divine';
import { GODS, GOD_KINDS } from './gods';
import { CAMPAIGN } from './scenario';
import { World } from './world';

function city(): World {
  const world = new World(28, 7);
  for (let x = 1; x < 27; x++) world.grid.road[world.grid.index(x, 10)] = 1;
  world.treasury = 20000;
  return world;
}

describe('the pantheon', () => {
  test('is twelve gods, each with a sanctuary of their own', () => {
    expect(GOD_KINDS.length).toBe(12);
    expect(SANCTUARY_KINDS.length).toBe(12);
    for (const kind of GOD_KINDS) expect(BUILDINGS[GODS[kind].sanctuary].size).toBe(3);
  });

  test('every god can bless and can curse', () => {
    for (const kind of GOD_KINDS) {
      expect(typeof BLESSINGS[kind]).toBe('function');
      expect(typeof WRATHS[kind]).toBe('function');
    }
  });

  test('an adventure invites only some of them', () => {
    for (const scenario of CAMPAIGN) {
      expect(scenario.gods.length).toBeGreaterThan(3);
      expect(scenario.gods.length).toBeLessThan(7);
    }
  });
});

describe('sanctuaries', () => {
  test('may only be raised to a god who attends the city', () => {
    const world = city();

    expect(world.scenario.gods).toContain('demeter');
    expect(world.canPlace('sanctuaryDemeter', 3, 11).ok).toBe(true);
    expect(world.canPlace('sanctuaryAres', 3, 11)).toEqual({
      ok: false,
      reason: 'That god does not attend this city',
    });
  });
});

describe('divine acts', () => {
  test('Hades pays in silver and takes it back', () => {
    const world = city();
    const before = world.treasury;

    BLESSINGS.hades(world);
    expect(world.treasury).toBe(before + SILVER_GIFT);

    WRATHS.hades(world);
    expect(world.treasury).toBeLessThan(before + SILVER_GIFT);
  });

  test('Ares raises companies, and throws down the walls in anger', () => {
    const world = city();
    world.placeWall(4, 12);
    world.placeWall(5, 12);

    BLESSINGS.ares(world);
    expect(world.army.rabble).toBeGreaterThan(0);

    WRATHS.ares(world);
    expect(world.wallLength).toBe(0);
  });

  test('Apollo heals the city, and sickens it', () => {
    const world = city();
    expect(world.place('house', 4, 11)).toBe(true);
    const house = [...world.buildings.values()][0];
    house.disease = 40;

    BLESSINGS.apollo(world);
    expect(house.disease).toBe(0);

    WRATHS.apollo(world);
    expect(house.disease).toBeGreaterThan(90);
  });
});
