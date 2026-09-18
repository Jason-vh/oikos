import type { ActionResult, Building, BuildingKind, City, Resource, StallGood, Stalls } from './types';
import { VENDOR_COST, isFood } from './catalog';
import { HOUSE_FOOD_CAP, HOUSE_OIL_CAP, OIL_DROP_AMOUNT, VENDOR_DROP_AMOUNT } from './balance';

export const STALL_GOODS: StallGood[] = ['food', 'oil'];

export interface StallTrade {
  name: string;
  opening: string;
  source: BuildingKind;
  houseCap: number;
  drop: number;
  carries(resource: Resource): boolean;
}

export const STALL_TRADES: Record<StallGood, StallTrade> = {
  food: {
    name: 'food stall',
    opening: 'A food stall joins the agora.',
    source: 'granary',
    houseCap: HOUSE_FOOD_CAP,
    drop: VENDOR_DROP_AMOUNT,
    carries: (resource) => isFood(resource) && resource !== 'olives',
  },
  oil: {
    name: 'oil stall',
    opening: 'An oil stall joins the agora.',
    source: 'press',
    houseCap: HOUSE_OIL_CAP,
    drop: OIL_DROP_AMOUNT,
    carries: (resource) => resource === 'oil',
  },
};

export function stallGoodOf(resource: Resource | null): StallGood | null {
  if (!resource) return null;
  return STALL_GOODS.find((good) => STALL_TRADES[good].carries(resource)) ?? null;
}

export function stallOf(building: Building, good: StallGood): { installed: boolean; enabled: boolean } {
  return building.stalls[good] ?? { installed: false, enabled: false };
}

export function stallServing(building: Building, good: StallGood): boolean {
  return building.kind === 'agora' && building.connected && stallOf(building, good).enabled;
}

export function stallsInstalled(stalls: Stalls): number {
  return STALL_GOODS.filter((good) => stalls[good]?.installed).length;
}

export function setStall(city: City, agora: Building, good: StallGood, enabled: boolean): ActionResult {
  const trade = STALL_TRADES[good];
  const stall = stallOf(agora, good);
  if (!enabled) {
    agora.stalls[good] = { installed: stall.installed, enabled: false };
    return { ok: true, reason: `The ${trade.name} is closed.` };
  }
  if (stall.enabled) return { ok: true, reason: `The ${trade.name} is already open.` };
  if (stall.installed) {
    agora.stalls[good] = { installed: true, enabled: true };
    return { ok: true, reason: `The ${trade.name} is open again.` };
  }
  if (city.money < VENDOR_COST) return { ok: false, reason: 'Not enough drachmas.' };
  city.money -= VENDOR_COST;
  agora.stalls[good] = { installed: true, enabled: true };
  return { ok: true, reason: trade.opening };
}
