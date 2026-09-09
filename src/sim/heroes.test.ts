import { describe, expect, test } from 'bun:test';
import { HEROES, HERO_STAY_MONTHS, slays, summonable, type HeroCall } from './heroes';
import { TICKS_PER_MONTH } from './time';
import { FINISHED, createBuilding } from './types';
import { levelGround } from './testing';
import { World } from './world';

const call = (over: Partial<HeroCall> = {}): HeroCall => ({
  population: 0,
  companies: 0,
  sanctuaries: 0,
  treasury: 0,
  standing: 0,
  eliteHouses: 0,
  ...over,
});

describe('heroes', () => {
  test('answer only when the city meets what they ask', () => {
    expect(summonable(call())).toEqual([]);
    expect(summonable(call({ companies: 3, sanctuaries: 1 }))).toEqual(['achilles']);
    expect(summonable(call({ sanctuaries: 2, treasury: 3000 }))).toEqual(['perseus']);
  });

  test('each kills one monster and no other', () => {
    const medusa = { name: 'Medusa', slayer: 'perseus' as const, monthsHere: 0 };

    expect(slays('perseus', medusa)).toBe(true);
    expect(slays('achilles', medusa)).toBe(false);
    expect(slays('perseus', null)).toBe(false);
  });
});

describe('a city and its hero', () => {
  function city(): World {
    const world = levelGround(new World(28, 7));
    for (let x = 1; x < 27; x++) world.grid.road[world.grid.index(x, 10)] = 1;
    world.treasury = 20000;
    return world;
  }

  test('needs a hall before anyone answers', () => {
    const world = city();
    for (const city of Object.keys(world.goodwill)) world.goodwill[city] = 100;
    world.army.hoplite = 5;

    expect(world.summon('achilles')).toBe(false);
  });

  test('summons a hero, who leaves after two years', () => {
    const world = city();
    expect(world.place('palace', 3, 11)).toBe(true);
    expect(world.place('heroHall', 8, 11)).toBe(true);
    const quarried = createBuilding(9000, 'masonryShop', 24, 14, 2);
    quarried.stock.marble = 100;
    world.restore(quarried);
    expect(world.place('sanctuaryDemeter', 14, 11)).toBe(true);
    for (const building of world.buildings.values()) {
      if (building.kind === 'sanctuaryDemeter') building.built = FINISHED;
    }
    world.army.rabble = 3;

    expect(world.summon('achilles')).toBe(true);
    expect(world.hero).toEqual({ kind: 'achilles', monthsLeft: HERO_STAY_MONTHS });
    expect(world.summon('perseus')).toBe(false);

    for (let tick = 0; tick < TICKS_PER_MONTH; tick++) world.update();
    expect(world.hero?.monthsLeft).toBe(HERO_STAY_MONTHS - 1);
  });

  test('a monster tears the city up until its slayer arrives', () => {
    const world = city();
    world.monster = { name: 'Medusa', slayer: 'perseus', monthsHere: 0 };
    world.place('granary', 20, 11);

    for (let tick = 0; tick < TICKS_PER_MONTH; tick++) world.update();
    expect(world.monster?.monthsHere).toBe(1);

    world.hero = { kind: 'perseus', monthsLeft: 10 };
    for (let tick = 0; tick < TICKS_PER_MONTH; tick++) world.update();

    expect(world.monster).toBeNull();
    expect(HEROES.perseus.slays).toBe('Medusa');
  });
});
