import { bfsRoute, exitTile, nextRoamTile, northOf } from './pathing';
import { TICKS_PER_MONTH } from './time';
import type { Building, ServiceKind, Walker, WalkerKind } from './types';
import type { World } from './world';

const CITIZEN_TILES_PER_MONTH = 54.4;

export const ROAM_RANGE: Record<WalkerKind, number> = {
  cartPusher: 0,
  foodVendor: 44,
  waterCarrier: 27,
  clerk: 35,
};

export const WALKER_SPEED: Record<WalkerKind, number> = {
  cartPusher: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
  foodVendor: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
  waterCarrier: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
  clerk: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
};

export const WALKER_SERVICE: Partial<Record<WalkerKind, ServiceKind>> = {
  foodVendor: 'food',
  waterCarrier: 'water',
  clerk: 'tax',
};

const SUPPLY_FULL = 100;

export function spawnRoamer(world: World, home: Building, kind: WalkerKind): boolean {
  const start = exitTile(world.grid, home);
  if (start === -1) return false;

  world.addWalker({
    kind,
    homeId: home.id,
    targetId: -1,
    state: 'roaming',
    from: start,
    to: start,
    prev: -1,
    progress: 1,
    route: [],
    routeIndex: 0,
    stepsLeft: ROAM_RANGE[kind],
    cargo: 0,
  });
  return true;
}

export function spawnCartPusher(world: World, farm: Building, destinations: Set<number>, cargo: number): boolean {
  const start = exitTile(world.grid, farm);
  if (start === -1) return false;

  const route = bfsRoute(world.grid, start, (tile) => destinations.has(tile));
  if (!route) return false;

  world.addWalker({
    kind: 'cartPusher',
    homeId: farm.id,
    targetId: -1,
    state: 'delivering',
    from: route[0],
    to: route[0],
    prev: -1,
    progress: 1,
    route,
    routeIndex: 0,
    stepsLeft: route.length * 2,
    cargo,
  });
  return true;
}

export function updateWalkers(world: World): void {
  for (const walker of [...world.walkers.values()]) {
    walker.progress += WALKER_SPEED[walker.kind];
    while (walker.progress >= 1) {
      walker.progress -= 1;
      advance(world, walker);
      if (!world.walkers.has(walker.id)) break;
    }
  }
}

function advance(world: World, walker: Walker): void {
  walker.prev = walker.from;
  walker.from = walker.to;
  onTileEntered(world, walker);
  if (!world.walkers.has(walker.id)) return;

  const next = chooseNextTile(world, walker);
  if (next === -1 || !world.grid.isRoad(next)) {
    world.removeWalker(walker);
    return;
  }
  walker.to = next;
}

function onTileEntered(world: World, walker: Walker): void {
  const service = WALKER_SERVICE[walker.kind];
  if (service) {
    serveAdjacentHouses(world, walker.from, service);
    return;
  }
  if (walker.kind === 'cartPusher' && walker.state === 'delivering' && atRouteEnd(walker)) {
    deliverCargo(world, walker);
  }
}

function serveAdjacentHouses(world: World, tile: number, service: ServiceKind): void {
  for (const neighbour of world.grid.neighbours(tile)) {
    const building = world.buildingAt(neighbour);
    if (building?.kind === 'house') building.supply[service] = SUPPLY_FULL;
  }
}

function deliverCargo(world: World, walker: Walker): void {
  for (const neighbour of world.grid.neighbours(walker.from)) {
    const building = world.buildingAt(neighbour);
    if (building?.kind !== 'granary') continue;
    building.stock = Math.min(world.granaryCapacity, building.stock + walker.cargo);
    walker.cargo = 0;
    break;
  }
  walker.state = 'returning';
  walker.route = [...walker.route].reverse();
  walker.routeIndex = 0;
}

function atRouteEnd(walker: Walker): boolean {
  return walker.routeIndex >= walker.route.length - 1;
}

function chooseNextTile(world: World, walker: Walker): number {
  if (walker.state === 'roaming') {
    walker.stepsLeft -= 1;
    if (walker.stepsLeft > 0) return nextRoamTile(world.grid, walker.from, walker.prev);
    return startWalkingHome(world, walker);
  }

  walker.routeIndex += 1;
  if (walker.routeIndex >= walker.route.length) return -1;
  return walker.route[walker.routeIndex];
}

function startWalkingHome(world: World, walker: Walker): number {
  const home = world.buildings.get(walker.homeId);
  if (!home) return -1;

  const entry = entryTile(world, home);
  if (entry === -1) return -1;

  const route = bfsRoute(world.grid, walker.from, (tile) => tile === entry);
  if (!route || route.length < 2) return -1;

  walker.state = 'returning';
  walker.route = route;
  walker.routeIndex = 1;
  return route[1];
}

function entryTile(world: World, home: Building): number {
  if (home.kind === 'fountain') {
    const north = northOf(world.grid, home);
    if (north !== -1) return north;
  }
  return exitTile(world.grid, home);
}
