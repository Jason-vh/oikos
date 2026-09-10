import type { AppealBands } from './appeal';
import model from './model.json';
import type { ServiceKind } from './types';

export type ModelBuildingKey = keyof typeof model.buildings;
export type ModelHouseKey = keyof typeof model.houses;

export const MODEL_DIFFICULTIES = model.difficulties;
export const NORMAL = MODEL_DIFFICULTIES.indexOf('Normal');

export interface ModelBuilding {
  cost: number;
  appeal: AppealBands;
  workers: number;
  fireRisk: number;
  damageRisk: number;
  riskReducer: number;
}

export interface ModelHouse {
  capacity: number;
  taxRate: number;
  evolveAppeal: number;
  devolveAppeal: number;
  culture: number;
  needs: ServiceKind[];
  crimeRisk: number;
  diseaseRisk: number;
}

const NEEDS: [keyof (typeof model.houses)[ModelHouseKey], ServiceKind][] = [
  ['foodTypes', 'food'],
  ['water', 'water'],
  ['fleece', 'fleece'],
  ['oil', 'oil'],
  ['wine', 'wine'],
  ['arms', 'armour'],
  ['horses', 'horses'],
];

export function modelBuilding(key: ModelBuildingKey, difficulty: number): ModelBuilding {
  const row = model.buildings[key];
  return {
    cost: row.cost[difficulty],
    appeal: {
      initial: row.appealInitial,
      bandSize: row.appealBandSize,
      step: row.appealStep,
      range: row.appealRange,
    },
    workers: row.workers,
    fireRisk: row.fireRisk[difficulty],
    damageRisk: row.damageRisk[difficulty],
    riskReducer: row.riskReducer,
  };
}

export function modelHouse(key: ModelHouseKey, difficulty: number): ModelHouse {
  const row = model.houses[key];
  return {
    capacity: row.capacity[difficulty],
    taxRate: row.taxRate[difficulty],
    evolveAppeal: row.evolveAppeal[difficulty],
    devolveAppeal: row.devolveAppeal[difficulty],
    culture: row.culture[difficulty],
    needs: NEEDS.filter(([column]) => row[column][difficulty] > 0).map(([, service]) => service),
    crimeRisk: row.crimeRisk[difficulty],
    diseaseRisk: row.diseaseRisk[difficulty],
  };
}
