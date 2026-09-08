import type { AppealBands } from './appeal';
import type { BuildingKind, ServiceKind } from './types';

export interface BuildingDef {
  kind: BuildingKind;
  name: string;
  size: number;
  cost: number;
  colour: number;
  roofColour: number;
  height: number;
  workers: number;
  appeal: AppealBands;
  requiresMeadow: boolean;
  needsRoad: boolean;
  description: string;
}

const NO_APPEAL_GATE = Number.NEGATIVE_INFINITY;

export interface HouseTier {
  name: string;
  capacity: number;
  taxMultiplier: number;
  evolveAppeal: number;
  devolveAppeal: number;
  needs: ServiceKind[];
  appeal: AppealBands;
  colour: number;
  roofColour: number;
  height: number;
}

export const HOUSE_TIERS: HouseTier[] = [
  {
    name: 'Shack',
    capacity: 16,
    taxMultiplier: 1,
    evolveAppeal: NO_APPEAL_GATE,
    devolveAppeal: NO_APPEAL_GATE,
    needs: [],
    appeal: { initial: -3, bandSize: 1, step: 1, range: 2 },
    colour: 0xa08868,
    roofColour: 0x7a5a3a,
    height: 12,
  },
  {
    name: 'Hovel',
    capacity: 24,
    taxMultiplier: 1,
    evolveAppeal: NO_APPEAL_GATE,
    devolveAppeal: NO_APPEAL_GATE,
    needs: ['water'],
    appeal: { initial: -2, bandSize: 1, step: 1, range: 2 },
    colour: 0xbfa079,
    roofColour: 0x8d4f30,
    height: 15,
  },
  {
    name: 'Tenement',
    capacity: 32,
    taxMultiplier: 2,
    evolveAppeal: -12,
    devolveAppeal: -20,
    needs: ['water', 'food'],
    appeal: { initial: -1, bandSize: 1, step: 0, range: 1 },
    colour: 0xd8c39a,
    roofColour: 0xa2492b,
    height: 19,
  },
  {
    name: 'Homestead',
    capacity: 40,
    taxMultiplier: 2,
    evolveAppeal: 0,
    devolveAppeal: -8,
    needs: ['water', 'food'],
    appeal: { initial: 0, bandSize: 1, step: 0, range: 0 },
    colour: 0xeadcb8,
    roofColour: 0xb8502c,
    height: 24,
  },
];

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  house: {
    kind: 'house',
    name: 'Housing',
    size: 1,
    cost: 10,
    colour: 0xc8a878,
    roofColour: 0x9c4b2f,
    height: 14,
    workers: 0,
    appeal: HOUSE_TIERS[0].appeal,
    requiresMeadow: false,
    needsRoad: true,
    description: 'Citizens settle here and evolve as their needs are met.',
  },
  wheatFarm: {
    kind: 'wheatFarm',
    name: 'Wheat Farm',
    size: 2,
    cost: 40,
    colour: 0xd8c56a,
    roofColour: 0x8a6b3a,
    height: 12,
    workers: 10,
    appeal: { initial: -3, bandSize: 1, step: 1, range: 3 },
    requiresMeadow: true,
    needsRoad: true,
    description: 'Grows wheat on meadow. Cart pushers carry it to a granary.',
  },
  granary: {
    kind: 'granary',
    name: 'Granary',
    size: 2,
    cost: 60,
    colour: 0xb8b0a0,
    roofColour: 0x6f6a5c,
    height: 20,
    workers: 18,
    appeal: { initial: -12, bandSize: 1, step: 2, range: 4 },
    requiresMeadow: false,
    needsRoad: true,
    description: 'Stores food and sends vendors along the roads to feed houses.',
  },
  fountain: {
    kind: 'fountain',
    name: 'Fountain',
    size: 1,
    cost: 25,
    colour: 0x8fbcd4,
    roofColour: 0xdfe9ef,
    height: 8,
    workers: 4,
    appeal: { initial: 4, bandSize: 2, step: -2, range: 4 },
    requiresMeadow: false,
    needsRoad: true,
    description: 'Sends water carriers along the roads.',
  },
  statue: {
    kind: 'statue',
    name: 'Statue',
    size: 1,
    cost: 30,
    colour: 0xe8e2d4,
    roofColour: 0xf6f2e8,
    height: 22,
    workers: 0,
    appeal: { initial: 8, bandSize: 1, step: -1, range: 3 },
    requiresMeadow: false,
    needsRoad: false,
    description: 'Beautifies the surrounding area.',
  },
  taxOffice: {
    kind: 'taxOffice',
    name: 'Tax Office',
    size: 2,
    cost: 25,
    colour: 0xcfc0a2,
    roofColour: 0x4f6f7a,
    height: 18,
    workers: 8,
    appeal: { initial: -4, bandSize: 1, step: 1, range: 2 },
    requiresMeadow: false,
    needsRoad: true,
    description: 'Sends a clerk to collect tax from the houses he passes.',
  },
};

export const PLACEABLE: BuildingKind[] = ['house', 'wheatFarm', 'granary', 'fountain', 'taxOffice', 'statue'];

export const LABOUR_PRIORITY: BuildingKind[] = [
  'wheatFarm',
  'granary',
  'fountain',
  'taxOffice',
  'statue',
  'house',
];

export const ROAD_COST = 4;

export const ROADBLOCK_COST = 8;
