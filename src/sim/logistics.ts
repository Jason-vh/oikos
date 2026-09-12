import type { Building, BuildingKind, Walker, WalkerKind, World } from './types';
import { ROAD_BUDGET } from './balance';
import { accessDoors, buildServiceCircuit, exitTile, mapOf } from './grid';
import { primaryCity } from './city';

const CIRCUIT_WALKER: Partial<Record<BuildingKind, WalkerKind>> = {
  agora: 'vendor',
  fountain: 'water',
  maintenance: 'maintenance',
};

export interface ServiceRoute {
  path: number[];
  servedIds: number[];
  live: boolean;
}

export function serviceRoute(world: World, building: Building): ServiceRoute | null {
  const kind = CIRCUIT_WALKER[building.kind];
  if (!kind || !building.connected) return null;
  if (building.kind === 'agora' && !building.vendorInstalled) return null;

  const city = primaryCity(world);
  const active = city.walkers.find((walker) => walker.homeId === building.id && walker.kind === kind);
  const path = active ? active.path : plannedCircuit(world, building);
  if (path.length <= 1) return null;

  const map = mapOf(world);
  const roads = new Set(city.roads);
  const onRoute = new Set(path);
  const servesEveryKind = kind === 'maintenance';
  const servedIds = city.buildings
    .filter((candidate) => candidate.id !== building.id)
    .filter((candidate) => servesEveryKind || candidate.kind === 'house')
    .filter((candidate) => accessDoors(map, roads, candidate).some((tile) => onRoute.has(tile)))
    .map((candidate) => candidate.id);

  return { path, servedIds, live: active !== undefined };
}

function plannedCircuit(world: World, building: Building): number[] {
  const exit = exitTile(world, building);
  return exit === -1 ? [] : buildServiceCircuit(world, exit, ROAD_BUDGET);
}

export function walkerRoute(walker: Walker): number[] {
  return walker.path.slice(walker.step);
}

const SUPPLY_KINDS = new Set<BuildingKind>(['farm', 'granary', 'stockpile']);

export interface DeliveryRoute {
  walkerId: number;
  path: number[];
  otherId: number;
}

export function deliveryRoutes(world: World, building: Building): DeliveryRoute[] {
  if (!SUPPLY_KINDS.has(building.kind)) return [];
  const routes: DeliveryRoute[] = [];
  for (const walker of primaryCity(world).walkers) {
    if (walker.targetId === null) continue;
    if ((walker.kind === 'cart' || walker.kind === 'buyer') && walker.homeId === building.id) {
      routes.push({ walkerId: walker.id, path: walker.path, otherId: walker.targetId });
    } else if ((walker.kind === 'cart' || walker.kind === 'buyer') && walker.targetId === building.id) {
      routes.push({ walkerId: walker.id, path: walker.path, otherId: walker.homeId });
    }
  }
  return routes;
}
