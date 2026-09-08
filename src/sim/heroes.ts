import type { CitySnapshot } from './scenario';

export const HERO_KINDS = ['achilles', 'hercules', 'perseus', 'odysseus'] as const;
export type HeroKind = (typeof HERO_KINDS)[number];

export interface HeroCall {
  population: number;
  companies: number;
  sanctuaries: number;
  treasury: number;
  standing: number;
  eliteHouses: number;
}

export interface HeroDef {
  kind: HeroKind;
  name: string;
  slays: string;
  demands: string;
  ready: (call: HeroCall) => boolean;
}

export const HEROES: Record<HeroKind, HeroDef> = {
  achilles: {
    kind: 'achilles',
    name: 'Achilles',
    slays: 'Hector',
    demands: '3 companies and a sanctuary',
    ready: (call) => call.companies >= 3 && call.sanctuaries >= 1,
  },
  hercules: {
    kind: 'hercules',
    name: 'Hercules',
    slays: 'Cerberus',
    demands: '1500 citizens and two sanctuaries',
    ready: (call) => call.population >= 1500 && call.sanctuaries >= 2,
  },
  perseus: {
    kind: 'perseus',
    name: 'Perseus',
    slays: 'Medusa',
    demands: 'two sanctuaries and 3000 drachmas',
    ready: (call) => call.sanctuaries >= 2 && call.treasury >= 3000,
  },
  odysseus: {
    kind: 'odysseus',
    name: 'Odysseus',
    slays: 'Scylla',
    demands: 'standing of 70 and 8 elite houses',
    ready: (call) => call.standing >= 70 && call.eliteHouses >= 8,
  },
};

export const HERO_STAY_MONTHS = 24;
export const HERO_COMPANIES = 4;

export interface Monster {
  name: string;
  slayer: HeroKind;
  monthsHere: number;
}

export const MONSTERS: Record<string, HeroKind> = {
  Hector: 'achilles',
  Cerberus: 'hercules',
  Medusa: 'perseus',
  Scylla: 'odysseus',
};

export function callFor(city: CitySnapshot, standing: number, eliteHouses: number): HeroCall {
  return {
    population: city.population,
    companies: city.companies,
    sanctuaries: city.sanctuaries,
    treasury: city.treasury,
    standing,
    eliteHouses,
  };
}

export function summonable(call: HeroCall): HeroKind[] {
  return HERO_KINDS.filter((kind) => HEROES[kind].ready(call));
}

export function slays(hero: HeroKind, monster: Monster | null): boolean {
  return monster !== null && MONSTERS[monster.name] === hero;
}
