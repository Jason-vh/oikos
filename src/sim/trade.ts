import { BUILDINGS } from './buildings';
import type { Building, Good } from './types';

export type TradeDirection = 'export' | 'import';

export interface TradeRoute {
  id: string;
  city: string;
  good: Good;
  direction: TradeDirection;
  price: number;
  cartloadsPerMonth: number;
}

export const TRADE_ROUTES: TradeRoute[] = [
  { id: 'corinth', city: 'Corinth', good: 'oil', direction: 'export', price: 28, cartloadsPerMonth: 6 },
  { id: 'knossos', city: 'Knossos', good: 'oil', direction: 'export', price: 21, cartloadsPerMonth: 12 },
  { id: 'mycenae', city: 'Mycenae', good: 'food', direction: 'import', price: 17, cartloadsPerMonth: 8 },
  { id: 'troy', city: 'Troy', good: 'food', direction: 'import', price: 12, cartloadsPerMonth: 4 },
  { id: 'thebes', city: 'Thebes', good: 'wine', direction: 'export', price: 34, cartloadsPerMonth: 5 },
  { id: 'sparta', city: 'Sparta', good: 'fleece', direction: 'import', price: 15, cartloadsPerMonth: 6 },
];

export interface TradeReport {
  earned: number;
  spent: number;
  exported: number;
  imported: number;
}

export const NO_TRADE: TradeReport = { earned: 0, spent: 0, exported: 0, imported: 0 };

export function newTradeOrders(): Record<string, boolean> {
  return Object.fromEntries(TRADE_ROUTES.map((route) => [route.id, false]));
}

export function describeRoute(route: TradeRoute): string {
  const verb = route.direction === 'export' ? 'buys' : 'sells';
  return `${route.city} ${verb} ${route.good} at ${route.price}`;
}

export function trade(
  posts: Building[],
  orders: Record<string, boolean>,
  treasury: number,
  willing: (routeId: string) => boolean = () => true,
): TradeReport {
  const report = { ...NO_TRADE };
  const capacity = BUILDINGS.tradingPost.capacity;

  for (const route of TRADE_ROUTES) {
    if (!orders[route.id] || !willing(route.id)) continue;
    let remaining = route.cartloadsPerMonth;

    for (const post of posts) {
      if (remaining === 0) break;

      if (route.direction === 'export') {
        const sold = Math.min(remaining, post.stock[route.good]);
        post.stock[route.good] -= sold;
        report.earned += sold * route.price;
        report.exported += sold;
        remaining -= sold;
        continue;
      }

      const affordable = Math.floor((treasury + report.earned - report.spent) / route.price);
      const bought = Math.min(remaining, capacity - post.stock[route.good], Math.max(0, affordable));
      post.stock[route.good] += bought;
      report.spent += bought * route.price;
      report.imported += bought;
      remaining -= bought;
    }
  }

  return report;
}
