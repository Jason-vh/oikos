import { HOUSE_TIERS } from './buildings';
import type { HouseTier } from './buildings';
import type { Building } from './types';
import type { World } from './world';

const SUPPLY_DECAY_PER_TICK = 0.12;
const EVOLUTION_INTERVAL = 25;

export function updateHouses(world: World): void {
  const evaluating = world.tick % EVOLUTION_INTERVAL === 0;

  for (const building of world.buildings.values()) {
    if (building.kind !== 'house') continue;

    building.supply.food = Math.max(0, building.supply.food - SUPPLY_DECAY_PER_TICK);
    building.supply.water = Math.max(0, building.supply.water - SUPPLY_DECAY_PER_TICK);

    if (evaluating) evaluate(world, building);
  }
}

function evaluate(world: World, house: Building): void {
  const appeal = world.grid.appeal[world.grid.index(house.x, house.y)];
  const next = HOUSE_TIERS[house.tier + 1];
  const current = HOUSE_TIERS[house.tier];

  if (next && meetsNeeds(house, next) && appeal >= next.evolveAppeal) {
    setTier(world, house, house.tier + 1);
  } else if (house.tier > 0 && (!meetsNeeds(house, current) || appeal < current.devolveAppeal)) {
    setTier(world, house, house.tier - 1);
  }

  const capacity = HOUSE_TIERS[house.tier].capacity;
  if (house.population < capacity) house.population += 1;
  if (house.population > capacity) house.population = capacity;
}

function setTier(world: World, house: Building, tier: number): void {
  house.tier = tier;
  world.invalidateAppeal();
}

function meetsNeeds(house: Building, tier: HouseTier): boolean {
  return tier.needs.every((need) => house.supply[need] > 0);
}
