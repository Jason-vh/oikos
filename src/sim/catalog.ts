import type { BuildingKind, Rotation } from './types';

export interface BuildingDefinition {
  name: string;
  width: number;
  depth: number;
  cost: number;
  jobs: number;
  upkeep: number;
  description: string;
}

export const BUILDINGS: Record<BuildingKind, BuildingDefinition> = {
  house: { name: 'Dwelling', width: 3, depth: 3, cost: 40, jobs: 0, upkeep: 0, description: 'A home for eight settlers. Food and water unlock better housing.' },
  farm: { name: 'Wheat farm', width: 4, depth: 4, cost: 140, jobs: 6, upkeep: 4, description: 'Grows food on fertile ground. A cart takes each harvest to a granary.' },
  granary: { name: 'Granary', width: 3, depth: 3, cost: 120, jobs: 2, upkeep: 2, description: 'Stores food from farms. Agora buyers collect supplies here.' },
  agora: { name: 'Agora', width: 3, depth: 3, cost: 100, jobs: 3, upkeep: 3, description: 'Add a food vendor to fetch food and distribute it along roads.' },
  fountain: { name: 'Fountain', width: 2, depth: 2, cost: 70, jobs: 2, upkeep: 2, description: 'A water carrier supplies homes along connected roads.' },
  maintenance: { name: 'Maintenance post', width: 2, depth: 2, cost: 90, jobs: 2, upkeep: 2, description: 'A caretaker walks the roads and repairs nearby buildings.' },
};
export const HOUSE_NAMES = ['Vacant plot', 'Dwelling', 'Cottage', 'Courtyard house'];
export const HOUSE_CAPACITY = [0, 8, 12, 20];
export const ROAD_COST = 2;
export const VENDOR_COST = 50;
export const STARTING_MONEY = 1600;
export const MONTH_SECONDS = 60;

export function footprint(kind: BuildingKind, rotation: Rotation = 0): { width: number; depth: number } {
  const definition = BUILDINGS[kind];
  if (rotation % 2 === 1) return { width: definition.depth, depth: definition.width };
  return { width: definition.width, depth: definition.depth };
}
