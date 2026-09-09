import { BUILDINGS, UNITS_PER_CARTLOAD, isDwelling } from './buildings';
import { RISK_LIMIT } from './hazards';
import type { GodKind } from './gods';
import { AFFLICTION_LIMIT } from './unrest';
import type { World } from './world';

export const SILVER_GIFT = 600;
export const HADES_TRIBUTE = 400;
export const ZEUS_APPEAL_MONTHS = 12;
export const ARES_COMPANIES = 3;
const STOLEN_SHARE = 0.1;
const HERA_SUPPLY = 60;

type Act = (world: World) => void;

export const BLESSINGS: Record<GodKind, Act> = {
  zeus: (world) => {
    world.divineFavourMonths = ZEUS_APPEAL_MONTHS;
  },
  poseidon: (world) => {
    world.treasury += world.trade.earned;
  },
  demeter: (world) => stockEvery(world, 'granary', 'food'),
  athena: (world) => {
    world.army.hoplite += world.army.hoplite;
  },
  artemis: (world) => stockEvery(world, 'granary', 'food'),
  apollo: (world) => {
    for (const house of dwellings(world)) house.disease = 0;
  },
  ares: (world) => {
    world.army.rabble += ARES_COMPANIES;
  },
  hephaestus: (world) => {
    for (const building of world.buildings.values()) building.fireRisk = 0;
  },
  aphrodite: (world) => {
    world.sentiment = { ...world.sentiment, popularity: 100 };
  },
  hermes: (world) => {
    for (const building of world.buildings.values()) {
      const produces = BUILDINGS[building.kind].produces;
      if (produces) building.stock[produces] += UNITS_PER_CARTLOAD;
    }
  },
  dionysus: (world) => stockEvery(world, 'tradingPost', 'wine'),
  hades: (world) => {
    world.treasury += SILVER_GIFT;
  },
  hera: (world) => {
    for (const house of dwellings(world)) {
      for (const service of Object.keys(house.supply) as (keyof typeof house.supply)[]) {
        house.supply[service] = Math.max(house.supply[service], HERA_SUPPLY);
      }
    }
  },
  atlas: (world) => {
    for (const building of world.buildings.values()) {
      if (BUILDINGS[building.kind].produces === 'marble') building.stock.marble += UNITS_PER_CARTLOAD;
    }
  },
};

export const WRATHS: Record<GodKind, Act> = {
  zeus: (world) => world.razeOne(),
  poseidon: (world) => {
    for (const building of world.buildings.values()) {
      if (building.kind === 'tradingPost') building.stock.oil = 0;
    }
  },
  demeter: (world) => {
    for (const building of world.buildings.values()) {
      if (BUILDINGS[building.kind].produces === 'food') building.stock.food = 0;
    }
  },
  athena: (world) => {
    world.army = { rabble: 0, hoplite: 0, horseman: 0 };
  },
  artemis: (world) => {
    for (const house of dwellings(world)) house.population = Math.floor(house.population * 0.9);
  },
  apollo: (world) => {
    for (const house of dwellings(world)) house.disease = AFFLICTION_LIMIT - 1;
  },
  ares: (world) => {
    world.grid.wall.fill(0);
    for (const building of [...world.buildings.values()]) {
      if (building.kind === 'tower') world.demolish(building.x, building.y);
    }
  },
  hephaestus: (world) => {
    const victim = world.anyBuilding();
    if (victim) victim.fireRisk = RISK_LIMIT;
  },
  aphrodite: (world) => {
    for (const house of dwellings(world)) {
      house.population -= Math.ceil(house.population * STOLEN_SHARE);
    }
  },
  hermes: (world) => {
    for (const building of world.buildings.values()) {
      if (building.kind === 'granary' || building.kind === 'agora') building.stock.food = 0;
    }
  },
  dionysus: (world) => {
    world.sentiment = { ...world.sentiment, popularity: Math.max(0, world.sentiment.popularity - 20) };
  },
  hades: (world) => {
    world.treasury -= Math.min(world.treasury, HADES_TRIBUTE);
  },
  hera: (world) => {
    world.sentiment = { ...world.sentiment, popularity: Math.max(0, world.sentiment.popularity - 30) };
  },
  atlas: (world) => {
    for (const building of world.buildings.values()) {
      if (BUILDINGS[building.kind].produces === 'marble') building.staff = 0;
    }
  },
};

function dwellings(world: World) {
  return [...world.buildings.values()].filter((building) => isDwelling(building.kind));
}

function stockEvery(world: World, kind: keyof typeof BUILDINGS, good: 'food' | 'wine'): void {
  for (const building of world.buildings.values()) {
    if (building.kind !== kind) continue;
    building.stock[good] = BUILDINGS[kind].capacity;
  }
}
