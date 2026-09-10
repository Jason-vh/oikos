import type { Building, BuildingKind, Walker, WalkerKind, World } from './types';
import { ROAD_BUDGET } from './balance';
import { buildServiceCircuit, exitTile, mapOf, perimeterTiles } from './grid';

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

  const active = world.walkers.find((walker) => walker.homeId === building.id && walker.kind === kind);
  const path = active ? active.path : plannedCircuit(world, building);
  if (path.length <= 1) return null;

  const map = mapOf(world);
  const onRoute = new Set(path);
  const servesEveryKind = kind === 'maintenance';
  const servedIds = world.buildings
    .filter((candidate) => candidate.id !== building.id)
    .filter((candidate) => servesEveryKind || candidate.kind === 'house')
    .filter((candidate) => perimeterTiles(map, candidate).some((tile) => onRoute.has(tile)))
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
