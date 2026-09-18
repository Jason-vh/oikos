import type { BuildingKind, Food, Good, Material, Resource, Rotation } from './types';

export const FOODS: Food[] = ['wheat', 'carrots', 'fish', 'meat', 'olives'];
export const MATERIALS: Material[] = ['lumber', 'clay', 'stone'];
export const GOODS: Good[] = ['oil'];
export const RESOURCES: Resource[] = [...FOODS, ...MATERIALS, ...GOODS];
export function isFood(resource: Resource): resource is Food { return (FOODS as Resource[]).includes(resource); }

export interface ShoreFootprint { land: number }

export type GroundRule = 'buildable' | 'fertile' | 'grove';

export interface BuildingDefinition {
  ground?: GroundRule;
  name: string;
  width: number;
  depth: number;
  cost: number;
  jobs: number;
  upkeep: number;
  description: string;
  shore?: ShoreFootprint;
}

export const BUILDINGS: Record<BuildingKind, BuildingDefinition> = {
  house: { name: 'Dwelling', width: 3, depth: 3, cost: 40, jobs: 0, upkeep: 0, description: 'A home for eight settlers. Food and water unlock better housing.' },
  farm: { name: 'Wheat farm', width: 4, depth: 4, cost: 140, jobs: 6, upkeep: 4, ground: 'fertile', description: 'Grows food on fertile ground. A cart takes each harvest to a granary.' },
  orchard: { name: 'Olive orchard', width: 4, depth: 4, cost: 160, jobs: 5, upkeep: 4, ground: 'grove', description: 'Olives root in grass, scrub or fertile ground, and ripen slowly. A cart takes the crop to a press.' },
  press: { name: 'Olive press', width: 2, depth: 3, cost: 130, jobs: 4, upkeep: 3, description: 'Presses olives into oil in batches. An agora oil stall sends its buyer here.' },
  granary: { name: 'Granary', width: 3, depth: 3, cost: 120, jobs: 2, upkeep: 2, description: 'Stores food from farms. Agora buyers collect supplies here.' },
  agora: { name: 'Agora', width: 3, depth: 3, cost: 100, jobs: 3, upkeep: 3, description: 'Add a food vendor to fetch food and distribute it along roads.' },
  fountain: { name: 'Fountain', width: 2, depth: 2, cost: 70, jobs: 2, upkeep: 2, description: 'A water carrier supplies homes along connected roads.' },
  maintenance: { name: 'Maintenance post', width: 2, depth: 2, cost: 90, jobs: 2, upkeep: 2, description: 'A caretaker walks the roads and repairs nearby buildings.' },
  lodge: { name: "Hunter's lodge", width: 2, depth: 2, cost: 110, jobs: 3, upkeep: 3, description: 'A hunter stalks boar and rabbits nearby and brings back meat for the granary.' },
  woodcutter: { name: "Woodcutter's cabin", width: 2, depth: 2, cost: 90, jobs: 3, upkeep: 2, description: 'A woodcutter fells nearby forest and carts lumber to a stockpile.' },
  stockpile: { name: 'Stockpile', width: 3, depth: 3, cost: 100, jobs: 2, upkeep: 2, description: 'Stores lumber, clay and stone in eight bays.' },
  wharf: { name: 'Fishing wharf', width: 2, depth: 3, cost: 120, jobs: 3, upkeep: 3, shore: { land: 1 }, description: 'A quay on the shore with a jetty over the water. Its boat works the shoals nearby and brings back fish for the granary.' },
  harbour: { name: 'Harbour', width: 2, depth: 5, cost: 0, jobs: 0, upkeep: 0, shore: { land: 2 }, description: 'A quay on the shore and a pier over the water. Settlers land here, and porters bring it lumber from stockpiles; enough rebuilds the quay in stone, after which a renewable trade order ships lumber overseas for coin.' },
};
export const HOUSE_NAMES = ['Vacant plot', 'Dwelling', 'Cottage', 'Courtyard house', 'Townhouse'];
export const HOUSE_CAPACITY = [0, 8, 12, 20, 28];
export const TOP_TIER = 4;
export const ROAD_COST = 2;
export const VENDOR_COST = 50;
export const STARTING_MONEY = 900;
export const SCENARIO_MONEY = 2400;
export const MONTH_SECONDS = 60;

const STORING_KINDS = new Set<BuildingKind>(['farm', 'orchard', 'press', 'granary', 'agora', 'lodge', 'woodcutter', 'wharf', 'stockpile', 'harbour']);

export function storesGoods(kind: BuildingKind): boolean {
  return STORING_KINDS.has(kind);
}

export function footprint(kind: BuildingKind, rotation: Rotation = 0): { width: number; depth: number } {
  const definition = BUILDINGS[kind];
  if (rotation % 2 === 1) return { width: definition.depth, depth: definition.width };
  return { width: definition.width, depth: definition.depth };
}
