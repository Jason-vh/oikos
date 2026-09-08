import { isDwelling, tiersOf } from './buildings';
import { DIFFICULTIES } from './difficulty';
import type { HouseTier } from './buildings';
import { SERVICE_KINDS } from './types';
import type { Building, ServiceKind } from './types';
import type { World } from './world';

const SUPPLY_DECAY_PER_TICK: Record<ServiceKind, number> = {
  food: 0.05,
  water: 0.05,
  oil: 0.05,
  culture: 0.04,
  tax: 0.05,
  health: 0.05,
  safety: 0.05,
  wine: 0.04,
  fleece: 0.04,
  athletics: 0.04,
  drama: 0.04,
};
const EVOLUTION_INTERVAL = 25;

export function updateHouses(world: World): void {
  const evaluating = world.tick % EVOLUTION_INTERVAL === 0;

  for (const building of world.buildings.values()) {
    if (!isDwelling(building.kind)) continue;

    for (const service of SERVICE_KINDS) {
      building.supply[service] = Math.max(0, building.supply[service] - SUPPLY_DECAY_PER_TICK[service]);
    }

    if (evaluating) evaluate(world, building);
  }
}

function evaluate(world: World, house: Building): void {
  const appeal = world.grid.appeal[world.grid.index(house.x, house.y)];
  const tiers = tiersOf(house.kind);
  const next = tiers[house.tier + 1];
  const current = tiers[house.tier];

  const shift = DIFFICULTIES[world.difficulty].evolveAppealShift;

  if (next && meetsNeeds(house, next) && appeal >= next.evolveAppeal + shift) {
    setTier(world, house, house.tier + 1);
  } else if (house.tier > 0 && (!meetsNeeds(house, current) || appeal < current.devolveAppeal + shift)) {
    setTier(world, house, house.tier - 1);
  }

  house.population = Math.min(house.population, tiers[house.tier].capacity);
}

function setTier(world: World, house: Building, tier: number): void {
  house.tier = tier;
  world.invalidateAppeal();
}

function meetsNeeds(house: Building, tier: HouseTier): boolean {
  return tier.needs.every((need) => house.supply[need] > 0);
}
