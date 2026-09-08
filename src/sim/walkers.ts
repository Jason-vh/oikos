import { BUILDINGS, UNITS_PER_CARTLOAD } from './buildings';
import { bfsRoute, exitTile, nextRoamTile, northOf } from './pathing';
import { TICKS_PER_MONTH } from './time';
import type { Building, Good, ServiceKind, Walker, WalkerKind } from './types';
import type { World } from './world';

const CITIZEN_TILES_PER_MONTH = 54.4;

export const ROAM_RANGE: Record<WalkerKind, number> = {
  cartPusher: 0,
  deliveryman: 0,
  peddler: 44,
  waterCarrier: 27,
  clerk: 35,
};

export const WALKER_SPEED: Record<WalkerKind, number> = {
  cartPusher: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
  deliveryman: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
  peddler: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
  waterCarrier: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
  clerk: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
};

export const PEDDLER_LOAD = UNITS_PER_CARTLOAD;
const SALE_PER_HOUSE = 4;

export const WALKER_SERVICE: Partial<Record<WalkerKind, ServiceKind>> = {
  waterCarrier: 'water',
  clerk: 'tax',
};

const SOLD_AS: Record<Good, ServiceKind | null> = {
  food: 'food',
  oil: 'oil',
  olives: null,
};

const SUPPLY_FULL = 100;

export function spawnRoamer(
  world: World,
  home: Building,
  kind: WalkerKind,
  cargo = 0,
  good: Good = 'food',
): boolean {
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
    cargo,
    good,
  });
  return true;
}

export function spawnDeliveryman(world: World, agora: Building, sources: Set<number>, good: Good): boolean {
  return spawnCarrier(world, 'deliveryman', agora, sources, 0, good);
}

export function spawnCartPusher(
  world: World,
  producer: Building,
  destinations: Set<number>,
  cargo: number,
  good: Good,
): boolean {
  return spawnCarrier(world, 'cartPusher', producer, destinations, cargo, good);
}

function spawnCarrier(
  world: World,
  kind: WalkerKind,
  home: Building,
  destinations: Set<number>,
  cargo: number,
  good: Good,
): boolean {
  const start = exitTile(world.grid, home);
  if (start === -1) return false;

  const route = bfsRoute(world.grid, start, (tile) => destinations.has(tile));
  if (!route) return false;

  world.addWalker({
    kind,
    homeId: home.id,
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
    good,
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
  const service = walker.kind === 'peddler' ? SOLD_AS[walker.good] : WALKER_SERVICE[walker.kind];
  if (service) {
    serve(world, walker, service);
    return;
  }
  if (!atRouteEnd(walker)) return;

  if (walker.kind === 'cartPusher' && walker.state === 'delivering') deliverCargo(world, walker);
  if (walker.kind === 'deliveryman' && walker.state === 'delivering') collectCargo(world, walker);
  if (walker.kind === 'deliveryman' && walker.state === 'returning') stockHome(world, walker);
}

function serve(world: World, walker: Walker, service: ServiceKind): void {
  const selling = walker.kind === 'peddler';
  if (selling && walker.cargo < SALE_PER_HOUSE) return;

  const served = serveAdjacentHouses(world, walker.from, service);
  if (!selling) return;

  walker.cargo -= served * SALE_PER_HOUSE;
  if (walker.cargo < SALE_PER_HOUSE) walker.stepsLeft = 0;
}

function serveAdjacentHouses(world: World, tile: number, service: ServiceKind): number {
  let served = 0;
  for (const neighbour of world.grid.neighbours(tile)) {
    const building = world.buildingAt(neighbour);
    if (building?.kind !== 'house') continue;
    building.supply[service] = SUPPLY_FULL;
    served += 1;
  }
  return served;
}

function collectCargo(world: World, walker: Walker): void {
  for (const neighbour of world.grid.neighbours(walker.from)) {
    const source = world.buildingAt(neighbour);
    if (!source || BUILDINGS[source.kind].supplies !== walker.good || source.stock[walker.good] <= 0) continue;
    source.stock[walker.good] -= 1;
    walker.cargo = UNITS_PER_CARTLOAD;
    break;
  }
  turnBack(walker);
}

function stockHome(world: World, walker: Walker): void {
  const home = world.buildings.get(walker.homeId);
  if (!home) return;
  const capacity = BUILDINGS[home.kind].capacity;
  home.stock[walker.good] = Math.min(capacity, home.stock[walker.good] + walker.cargo);
  walker.cargo = 0;
}

function deliverCargo(world: World, walker: Walker): void {
  for (const neighbour of world.grid.neighbours(walker.from)) {
    const store = world.buildingAt(neighbour);
    if (!store || BUILDINGS[store.kind].accepts !== walker.good) continue;
    store.stock[walker.good] = Math.min(BUILDINGS[store.kind].capacity, store.stock[walker.good] + walker.cargo);
    walker.cargo = 0;
    break;
  }
  turnBack(walker);
}

function turnBack(walker: Walker): void {
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
