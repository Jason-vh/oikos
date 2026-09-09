import { describe, expect, test } from 'bun:test';
import { GOD_KINDS } from './gods';
import { OFFER_MOOD, QUESTS } from './quests';
import { TICKS_PER_MONTH } from './time';
import { createBuilding } from './types';
import { World } from './world';

function city(): World {
  const world = new World(28, 7);
  for (let x = 1; x < 27; x++) world.grid.road[world.grid.index(x, 10)] = 1;
  world.treasury = 20000;
  return world;
}

function stock(world: World, good: 'marble' | 'wine', amount: number): void {
  const store = createBuilding(9000, 'tradingPost', 24, 20, 2);
  store.stock[good] = amount;
  world.restore(store);
}

describe('quests', () => {
  test('every god has one to give', () => {
    for (const kind of GOD_KINDS) expect(QUESTS[kind].god).toBe(kind);
  });

  test('are offered only by a god who is pleased, and paid when met', () => {
    const world = city();
    stock(world, 'wine', 30);
    world.gods.dionysus.honoured = true;
    world.gods.dionysus.mood = OFFER_MOOD - 1;

    for (let tick = 0; tick < TICKS_PER_MONTH; tick++) world.update();
    expect(world.quests.dionysus).toBe('unoffered');

    world.gods.dionysus.mood = OFFER_MOOD + 5;
    world.scenario = { ...world.scenario, gods: ['dionysus'] };
    for (let tick = 0; tick < TICKS_PER_MONTH; tick++) world.update();
    expect(world.quests.dionysus).toBe('offered');

    const before = world.treasury;
    for (let tick = 0; tick < TICKS_PER_MONTH; tick++) world.update();

    expect(world.quests.dionysus).toBe('done');
    expect(world.treasury).toBeGreaterThan(before);
  });
});

describe('monuments', () => {
  test('wait on a fulfilled quest and cost marble', () => {
    const world = city();
    stock(world, 'marble', 100);

    expect(world.canPlace('monument', 3, 12)).toEqual({ ok: false, reason: 'Fulfil a quest first' });

    world.quests.hermes = 'done';
    expect(world.canPlace('monument', 3, 12).ok).toBe(true);

    world.place('monument', 3, 12);
    expect(world.stockOf('marble')).toBe(70);
  });
});
