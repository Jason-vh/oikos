import { describe, expect, test } from 'bun:test';
import { TICKS_PER_MONTH } from './time';
import { TRADE_ROUTES, newTradeOrders, trade } from './trade';
import { createBuilding } from './types';
import type { Building } from './types';
import { World } from './world';

function post(oil = 0, food = 0): Building {
  const building = createBuilding(1, 'tradingPost', 0, 0, 2);
  building.stock.oil = oil;
  building.stock.food = food;
  return building;
}

function orders(...open: string[]): Record<string, boolean> {
  const all = newTradeOrders();
  for (const id of open) all[id] = true;
  return all;
}

describe('trade', () => {
  test('sells what the post holds, up to the month\'s quota', () => {
    const corinth = TRADE_ROUTES[0];
    const seller = post(20);

    const report = trade([seller], orders(corinth.id), 0);

    expect(report.exported).toBe(corinth.cartloadsPerMonth);
    expect(report.earned).toBe(corinth.cartloadsPerMonth * corinth.price);
    expect(seller.stock.oil).toBe(20 - corinth.cartloadsPerMonth);
  });

  test('buys only what the treasury can pay for', () => {
    const troy = TRADE_ROUTES[3];
    const buyer = post();

    const report = trade([buyer], orders(troy.id), troy.price * 2);

    expect(report.imported).toBe(2);
    expect(report.spent).toBe(troy.price * 2);
    expect(buyer.stock.food).toBe(2);
  });

  test('a closed route moves nothing', () => {
    const seller = post(20);

    expect(trade([seller], newTradeOrders(), 5000)).toEqual({
      earned: 0,
      spent: 0,
      exported: 0,
      imported: 0,
    });
    expect(seller.stock.oil).toBe(20);
  });
});

describe('a city that trades', () => {
  test('needs a manned post before an open route earns anything', () => {
    const world = new World(24, 11);
    for (let x = 1; x < 23; x++) world.grid.road[world.grid.index(x, 6)] = 1;
    world.treasury = 5000;
    world.tradeOrders.corinth = true;
    world.goodwill.corinth = 70;

    for (let tick = 0; tick < TICKS_PER_MONTH; tick++) world.update();
    expect(world.trade.earned).toBe(0);

    expect(world.place('tradingPost', 2, 7)).toBe(true);
    expect(world.place('house', 7, 7)).toBe(true);
    const built = [...world.buildings.values()].find((building) => building.kind === 'tradingPost')!;
    const house = [...world.buildings.values()].find((building) => building.kind === 'house')!;
    house.population = 8;
    world.hireWorkers();
    built.stock.oil = 4;

    for (let tick = 0; tick < TICKS_PER_MONTH; tick++) world.update();

    expect(world.trade.exported).toBe(4);
    expect(world.trade.earned).toBe(4 * TRADE_ROUTES[0].price);
  });
});
