import type { WalkerKind } from './types';

export const STEP = 0.25;
export const WALKER_SPEED = 3;
const LADEN_PACE: Partial<Record<WalkerKind, number>> = { cart: .72, porter: .8, immigrant: .82 };

export function walkerSpeed(kind: WalkerKind): number {
  return WALKER_SPEED * (LADEN_PACE[kind] ?? 1);
}
export const ROAD_BUDGET = 60;
export const EMPLOYMENT_SHARE = 0.5;
export const INCOME_PER_RESIDENT = 3;

export const FARM_GROW_SECONDS = 40;
export const ORCHARD_GROW_SECONDS = 70;
export const FARM_GROW_SPREAD = .3;
export const WALKER_PACE_SPREAD = .2;
export const WEAR_SPREAD = .4;
export const HOUSEHOLD_SPREAD = .3;
export const HARVEST_UNITS = 100;
export const PRESS_CAP = 200;
export const PRESS_BATCH_OLIVES = 50;
export const PRESS_BATCH_OIL = 30;
export const PRESS_SECONDS = 24;
export const FARM_STOCK_CAP = 300;
export const CART_CAPACITY = 100;
export const BUNDLE = 100;
export const GRANARY_SLOTS = 8;
export const AGORA_SLOTS = 3;
export const GRANARY_CAP = GRANARY_SLOTS * BUNDLE;
export const AGORA_CAP = AGORA_SLOTS * BUNDLE;
export const BUYER_FETCH_CAPACITY = 100;
export const VENDOR_TRIP_CAPACITY = 60;
export const VENDOR_DROP_AMOUNT = 8;

export const HOUSE_FOOD_CAP = 24;
export const HOUSE_WATER_CAP = 24;
export const HOUSE_OIL_CAP = 16;
export const OIL_DROP_AMOUNT = 6;
export const FOOD_CONSUMPTION_PER_RESIDENT = 0.02;
export const OIL_CONSUMPTION_PER_RESIDENT = 0.004;
export const WATER_DECAY_PER_SECOND = 0.15;

export const REPAIR_AMOUNT = 20;
export const CONDITION_DECAY_PER_SECOND = 100 / (20 * 60);

export const GRACE_SECONDS = 45;
export const UPGRADE_GRACE = 8;
export const ARRIVAL_INTERVAL = 2.5;
export const IMMIGRANT_PARTY = 4;
