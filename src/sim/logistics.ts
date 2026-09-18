import type { Building, BuildingKind, City, Errand, Resource, Walker, WalkerKind, World } from './types';
import { ROAD_BUDGET } from './balance';
import { accessDoors, buildServiceCircuit, exitTile, mapOf } from './grid';

const CIRCUIT_WALKER: Partial<Record<BuildingKind, WalkerKind>> = {
  agora: 'vendor',
  fountain: 'water',
  maintenance: 'maintenance',
};

const WALKER_ERRAND: Partial<Record<WalkerKind, Errand>> = {
  vendor: 'food',
  water: 'water',
  maintenance: 'repair',
  cart: 'goods',
  buyer: 'goods',
  porter: 'goods',
};

export interface Delivery {
  id: number;
  errand: Errand;
  resource: Resource | null;
  stocked: boolean;
}

const NEGLECTED_CONDITION = 50;

function stockedWith(building: Building, errand: Errand): boolean {
  if (errand === 'water') return building.water > 0;
  if (errand === 'food') return building.food > 0;
  if (errand === 'repair') return building.condition >= NEGLECTED_CONDITION;
  return true;
}

export function serviceCoverage(world: World, city: City, building: Building): Delivery[] {
  const kind = CIRCUIT_WALKER[building.kind];
  const errand = kind && WALKER_ERRAND[kind];
  if (!kind || !errand || !building.connected) return [];
  if (building.kind === 'agora' && !building.vendorInstalled) return [];

  const circuit = plannedCircuit(world, city, building);
  if (circuit.length <= 1) return [];

  const map = mapOf(world, city);
  const roads = new Set(city.roads);
  const onCircuit = new Set(circuit);
  const servesEveryKind = kind === 'maintenance';
  return city.buildings
    .filter((candidate) => candidate.id !== building.id)
    .filter((candidate) => servesEveryKind || candidate.kind === 'house')
    .filter((candidate) => accessDoors(map, roads, candidate).some((tile) => onCircuit.has(tile)))
    .map((candidate) => ({ id: candidate.id, errand, resource: null, stocked: stockedWith(candidate, errand) }));
}

function plannedCircuit(world: World, city: City, building: Building): number[] {
  const exit = exitTile(world, city, building);
  return exit === -1 ? [] : buildServiceCircuit(world, city, exit, ROAD_BUDGET);
}

const SUPPLY_KINDS = new Set<BuildingKind>(['farm', 'granary', 'stockpile']);

export function tradePartners(city: City, building: Building): Delivery[] {
  if (!SUPPLY_KINDS.has(building.kind)) return [];
  const partners = new Map<number, Delivery>();
  for (const walker of city.walkers) {
    if (walker.targetId === null) continue;
    if (walker.kind !== 'cart' && walker.kind !== 'buyer') continue;
    const partnerId = walker.homeId === building.id ? walker.targetId : walker.targetId === building.id ? walker.homeId : null;
    if (partnerId === null) continue;
    partners.set(partnerId, { id: partnerId, errand: 'goods', resource: walker.food, stocked: true });
  }
  return [...partners.values()];
}

export function walkerDelivery(walker: Walker): Delivery | null {
  const errand = WALKER_ERRAND[walker.kind];
  if (!errand || walker.targetId === null) return null;
  return { id: walker.targetId, errand, resource: errand === 'goods' ? walker.food : null, stocked: true };
}
