import type { BuildingKind, ServiceKind } from './types';

export interface BuildingDef {
  kind: BuildingKind;
  name: string;
  size: number;
  cost: number;
  colour: number;
  roofColour: number;
  height: number;
  desirability: number;
  desirabilityRange: number;
  requiresMeadow: boolean;
  needsRoad: boolean;
  description: string;
}

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  house: {
    kind: 'house',
    name: 'Housing',
    size: 1,
    cost: 10,
    colour: 0xc8a878,
    roofColour: 0x9c4b2f,
    height: 14,
    desirability: -2,
    desirabilityRange: 2,
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
    desirability: -4,
    desirabilityRange: 3,
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
    desirability: -3,
    desirabilityRange: 3,
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
    desirability: 3,
    desirabilityRange: 3,
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
    desirability: 8,
    desirabilityRange: 5,
    requiresMeadow: false,
    needsRoad: false,
    description: 'Beautifies the surrounding area.',
  },
};

export interface HouseTier {
  name: string;
  capacity: number;
  minDesirability: number;
  needs: ServiceKind[];
  colour: number;
  roofColour: number;
  height: number;
}

export const HOUSE_TIERS: HouseTier[] = [
  {
    name: 'Shack',
    capacity: 8,
    minDesirability: -30,
    needs: [],
    colour: 0xa08868,
    roofColour: 0x7a5a3a,
    height: 12,
  },
  {
    name: 'Hovel',
    capacity: 14,
    minDesirability: -12,
    needs: ['water'],
    colour: 0xbfa079,
    roofColour: 0x8d4f30,
    height: 15,
  },
  {
    name: 'Tenement',
    capacity: 24,
    minDesirability: 0,
    needs: ['water', 'food'],
    colour: 0xd8c39a,
    roofColour: 0xa2492b,
    height: 19,
  },
  {
    name: 'Homestead',
    capacity: 38,
    minDesirability: 10,
    needs: ['water', 'food'],
    colour: 0xeadcb8,
    roofColour: 0xb8502c,
    height: 24,
  },
];

export const PLACEABLE: BuildingKind[] = ['house', 'wheatFarm', 'granary', 'fountain', 'statue'];

export const ROAD_COST = 4;
