import type { ServiceKind } from './types';

export interface Game {
  name: string;
  contest: string;
  culture: ServiceKind | 'all';
  entryCost: number;
  prize: number;
}

export const GAMES: Game[] = [
  { name: 'Isthmian Games', contest: 'philosophy', culture: 'culture', entryCost: 500, prize: 1200 },
  { name: 'Pythian Games', contest: 'drama', culture: 'drama', entryCost: 600, prize: 1500 },
  { name: 'Nemean Games', contest: 'athletics', culture: 'athletics', entryCost: 700, prize: 1800 },
  { name: 'Olympic Games', contest: 'every art', culture: 'all', entryCost: 1000, prize: 3000 },
];

export const WINNING_SHARE = 0.6;
export const GAME_GOODWILL = 8;
export const HOSTING_REVENUE = 2500;

export function gameOfYear(year: number): Game {
  return GAMES[Math.abs(year) % GAMES.length];
}

export function culturedShare(
  houses: { supply: Record<ServiceKind, number> }[],
  culture: ServiceKind | 'all',
): number {
  if (houses.length === 0) return 0;

  const served = houses.filter((house) => {
    if (culture !== 'all') return house.supply[culture] > 0;
    return house.supply.culture > 0 && house.supply.athletics > 0 && house.supply.drama > 0;
  });
  return served.length / houses.length;
}

export function winsTheGames(share: number): boolean {
  return share >= WINNING_SHARE;
}
