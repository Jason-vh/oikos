import type { Building, Walker } from './types';
import { hash } from './island';
import {
  CONDITION_DECAY_PER_SECOND,
  FARM_GROW_SECONDS,
  FARM_GROW_SPREAD,
  FOOD_CONSUMPTION_PER_RESIDENT,
  HOUSEHOLD_SPREAD,
  OIL_CONSUMPTION_PER_RESIDENT,
  WALKER_PACE_SPREAD,
  WATER_DECAY_PER_SECOND,
  WEAR_SPREAD,
  walkerSpeed,
} from './balance';

const TRAIT = { growth: 1, pace: 2, wear: 3, appetite: 4, thirst: 5, look: 6 };
const VARIATION_SEED = 7919;

function trait(id: number, salt: number, spread: number): number {
  return 1 + (hash(id, salt, VARIATION_SEED) - .5) * spread;
}

export function growSeconds(field: Building, base: number): number {
  return base * trait(field.id, TRAIT.growth, FARM_GROW_SPREAD);
}

export function farmGrowSeconds(farm: Building): number {
  return growSeconds(farm, FARM_GROW_SECONDS);
}

export function walkerPace(walker: Pick<Walker, 'id' | 'kind'>): number {
  return walkerSpeed(walker.kind) * trait(walker.id, TRAIT.pace, WALKER_PACE_SPREAD);
}

export function wearPerSecond(building: Building): number {
  return CONDITION_DECAY_PER_SECOND * trait(building.id, TRAIT.wear, WEAR_SPREAD);
}

function householdDraw(house: Building, base: number): number {
  return base * trait(house.id, TRAIT.appetite, HOUSEHOLD_SPREAD);
}

export function appetitePerResident(house: Building): number {
  return householdDraw(house, FOOD_CONSUMPTION_PER_RESIDENT);
}

export function oilDrawPerResident(house: Building): number {
  return householdDraw(house, OIL_CONSUMPTION_PER_RESIDENT);
}

export function thirstPerSecond(house: Building): number {
  return WATER_DECAY_PER_SECOND * trait(house.id, TRAIT.thirst, HOUSEHOLD_SPREAD);
}

export function modelRoll(building: Building): number {
  return hash(building.id, TRAIT.look, VARIATION_SEED);
}
