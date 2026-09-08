import { isDwelling } from './buildings';
import type { Building } from './types';

export type UnitKind = 'rabble' | 'hoplite' | 'horseman';

export interface UnitDef {
  name: string;
  soldiersPerCompany: number;
  attack: number;
  hitPoints: number;
}

export const UNITS: Record<UnitKind, UnitDef> = {
  rabble: { name: 'Rabble', soldiersPerCompany: 48, attack: 5, hitPoints: 100 },
  hoplite: { name: 'Hoplites', soldiersPerCompany: 16, attack: 15, hitPoints: 150 },
  horseman: { name: 'Horsemen', soldiersPerCompany: 8, attack: 17, hitPoints: 250 },
};

export const MAX_COMPANIES = 20;

const COMMON_SOLDIERS = [0, 0, 5, 6, 10, 12, 15];
const ELITE_SOLDIERS = [0, 2, 4, 4];
const ELITE_UNIT: UnitKind[] = ['rabble', 'hoplite', 'hoplite', 'horseman'];

export type Army = Record<UnitKind, number>;

export const NO_ARMY: Army = { rabble: 0, hoplite: 0, horseman: 0 };

export function musterArmy(buildings: Iterable<Building>, hasPalace: boolean): Army {
  if (!hasPalace) return { ...NO_ARMY };

  const soldiers: Army = { ...NO_ARMY };
  for (const building of buildings) {
    if (!isDwelling(building.kind) || building.population === 0) continue;

    if (building.kind === 'house') {
      soldiers.rabble += COMMON_SOLDIERS[building.tier];
      continue;
    }
    soldiers[ELITE_UNIT[building.tier]] += ELITE_SOLDIERS[building.tier];
  }

  const army = { ...NO_ARMY };
  let companies = 0;
  for (const kind of ['horseman', 'hoplite', 'rabble'] as UnitKind[]) {
    const raised = Math.floor(soldiers[kind] / UNITS[kind].soldiersPerCompany);
    army[kind] = Math.max(0, Math.min(raised, MAX_COMPANIES - companies));
    companies += army[kind];
  }
  return army;
}

export function companiesIn(army: Army): number {
  return army.rabble + army.hoplite + army.horseman;
}

export function strengthOf(army: Army): number {
  let strength = 0;
  for (const kind of Object.keys(UNITS) as UnitKind[]) {
    strength += army[kind] * UNITS[kind].attack * UNITS[kind].hitPoints;
  }
  return strength;
}

export interface Invasion {
  year: number;
  nation: string;
  companies: number;
}

export interface Battle {
  won: boolean;
  invasion: Invasion;
}

const INVADER_STRENGTH_PER_COMPANY = UNITS.hoplite.attack * UNITS.hoplite.hitPoints;

export function fightInvasion(army: Army, invasion: Invasion): Battle {
  const attacking = invasion.companies * INVADER_STRENGTH_PER_COMPANY;
  return { won: strengthOf(army) >= attacking, invasion };
}
