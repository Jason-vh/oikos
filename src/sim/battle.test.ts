import { describe, expect, test } from 'bun:test';
import { landInvaders, musterDefenders, reachedPalace, stepBattle } from './battle';
import { Grid } from './grid';
import { UNITS } from './military';
import { TICKS_PER_MONTH } from './time';
import { World } from './world';

function grid(): Grid {
  return new Grid(24);
}

let counter = 0;
const nextId = () => ++counter;

describe('a battle on the map', () => {
  test('lands a company of invaders on the western edge', () => {
    const units = landInvaders(grid(), 3, nextId);

    expect(units.length).toBe(3);
    for (const unit of units) {
      expect(unit.side).toBe('invader');
      expect(unit.x).toBe(0);
    }
  });

  test('musters a defender for every company', () => {
    const units = musterDefenders({ rabble: 2, hoplite: 1, horseman: 0 }, 5, 5, nextId);

    expect(units.length).toBe(3);
    expect(units.filter((unit) => unit.kind === 'hoplite').length).toBe(1);
  });

  test('invaders walk towards the palace when nobody stands in the way', () => {
    const board = grid();
    const units = landInvaders(board, 1, nextId);
    const palace = { x: 12, y: 12 };

    for (let step = 0; step < 400; step++) stepBattle(units, palace, board);

    expect(units[0].x).toBeGreaterThan(0);
  });

  test('units in contact wear each other down until one falls', () => {
    const board = grid();
    const attacker = landInvaders(board, 1, nextId)[0];
    const defender = musterDefenders({ rabble: 1, hoplite: 0, horseman: 0 }, attacker.x, attacker.y, nextId)[0];

    let units = [attacker, defender];
    for (let step = 0; step < UNITS.rabble.hitPoints; step++) units = stepBattle(units, { x: 0, y: 0 }, board);

    expect(units.length).toBeLessThan(2);
  });

  test('an invader at the palace has taken the city', () => {
    const units = musterDefenders({ rabble: 1, hoplite: 0, horseman: 0 }, 4, 4, nextId);
    units[0].side = 'invader';

    expect(reachedPalace(units, { x: 4, y: 4 })).toBe(true);
    expect(reachedPalace(units, { x: 12, y: 12 })).toBe(false);
  });
});

describe('a city under invasion', () => {
  test('sees the enemy land in the year the scenario says', () => {
    const world = new World(28, 7);
    world.treasury = 20000;
    for (let x = 1; x < 27; x++) world.grid.road[world.grid.index(x, 10)] = 1;
    world.place('palace', 3, 11);

    const invasion = world.scenario.invasions[0];
    world.year = invasion.year;
    world.month = 5;
    for (let tick = 0; tick < TICKS_PER_MONTH; tick++) world.update();

    expect(world.invasion?.nation).toBe(invasion.nation);
    expect(world.units.some((unit) => unit.side === 'invader')).toBe(true);
  });
});
