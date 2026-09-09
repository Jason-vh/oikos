import { describe, expect, test } from 'bun:test';
import { NEUTRAL_MOOD, actFor, moodAfterMonth, moodName, newPantheon } from './gods';
import { TICKS_PER_MONTH } from './time';
import { FINISHED, createBuilding } from './types';
import { levelGround } from './testing';
import { World } from './world';

describe('divine mood', () => {
  test('rises while a sanctuary is staffed and falls when there is none', () => {
    expect(moodAfterMonth(50, 1, 1)).toBe(53);
    expect(moodAfterMonth(50, 1, 0)).toBe(51);
    expect(moodAfterMonth(50, 0, 0)).toBe(48);
  });

  test('never leaves the nought to hundred range', () => {
    expect(moodAfterMonth(99, 2, 2)).toBe(100);
    expect(moodAfterMonth(1, 0, 0)).toBe(0);
  });

  test('the pleased act generously, the wrathful strike, the rest do nothing', () => {
    expect(actFor(85, 0.1)).toBe('bless');
    expect(actFor(85, 0.9)).toBe(null);
    expect(actFor(15, 0.1)).toBe('curse');
    expect(actFor(50, 0.01)).toBe(null);
  });

  test('is named for the player, and unhonoured gods are indifferent', () => {
    expect(moodName(90, true)).toBe('Pleased');
    expect(moodName(10, true)).toBe('Wrathful');
    expect(moodName(90, false)).toBe('Indifferent');
  });

  test('starts neutral and unhonoured', () => {
    expect(newPantheon().hades).toEqual({ mood: NEUTRAL_MOOD, honoured: false, lastAct: null });
  });
});

function stockMarble(world: World): void {
  const quarried = createBuilding(9000, 'masonryShop', 0, 0, 2);
  quarried.stock.marble = 100;
  world.restore(quarried);
}

function finish(world: World, kind: string): void {
  for (const building of world.buildings.values()) {
    if (building.kind === kind) building.built = FINISHED;
  }
}

describe('a city and its gods', () => {
  test('ignores gods until a sanctuary stands, then answers to them', () => {
    const world = levelGround(new World(24, 11));
    for (let x = 1; x < 23; x++) world.grid.road[world.grid.index(x, 6)] = 1;
    world.treasury = 5000;

    for (let month = 0; month < 3; month++) {
      for (let tick = 0; tick < TICKS_PER_MONTH; tick++) world.update();
    }
    expect(world.gods.demeter).toEqual({ mood: NEUTRAL_MOOD, honoured: false, lastAct: null });

    stockMarble(world);
    expect(world.place('sanctuaryDemeter', 2, 7)).toBe(true);
    finish(world, 'sanctuaryDemeter');
    for (let tick = 0; tick < TICKS_PER_MONTH; tick++) world.update();

    expect(world.gods.demeter.honoured).toBe(true);
    expect(world.gods.demeter.mood).toBeGreaterThan(NEUTRAL_MOOD);
    expect(world.gods.hades.honoured).toBe(false);
  });
});
