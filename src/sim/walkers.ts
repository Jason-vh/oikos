import { BUILDINGS, UNITS_PER_CARTLOAD, isDwelling } from './buildings';
import { reassure } from './hazards';
import { bfsRoute, exitTile, nextRoamTile, northOf, roadAccessTiles } from './pathing';
import { TICKS_PER_MONTH } from './time';
import type { Building, Good, ServiceKind, Walker, WalkerKind } from './types';
import type { World } from './world';

const CITIZEN_TILES_PER_MONTH = 54.4;

export const ROAM_RANGE: Record<WalkerKind, number> = {
  cartPusher: 0,
  deliveryman: 0,
  peddler: 44,
  waterCarrier: 27,
  philosopher: 35,
  superintendent: 44,
  clerk: 35,
  doctor: 35,
  watchman: 30,
  athlete: 30,
  actor: 30,
  soldier: 0,
  invader: 0,
};

export const WALKER_SPEED: Record<WalkerKind, number> = {
  cartPusher: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
  deliveryman: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
  peddler: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
  waterCarrier: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
  philosopher: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
  superintendent: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
  clerk: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
  doctor: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
  watchman: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
  athlete: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
  actor: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
  soldier: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
  invader: CITIZEN_TILES_PER_MONTH / TICKS_PER_MONTH,
};

export const PEDDLER_LOAD = UNITS_PER_CARTLOAD;
const SALE_PER_HOUSE = 4;

export const WALKER_SERVICE: Partial<Record<WalkerKind, ServiceKind>> = {
  waterCarrier: 'water',
  philosopher: 'culture',
  clerk: 'tax',
  doctor: 'health',
  watchman: 'safety',
  athlete: 'athletics',
  actor: 'drama',
};

const SOLD_AS: Record<Good, ServiceKind | null> = {
  food: 'food',
  oil: 'oil',
  wine: 'wine',
  fleece: 'fleece',
  armour: 'armour',
  horses: 'horses',
  olives: null,
  grapes: null,
  wood: null,
  marble: null,
  bronze: null,
  sculpture: null,
};

const SUPPLY_FULL = 100;

const PERFORMERS: WalkerKind[] = ['philosopher', 'actor'];

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

export function spawnPerformer(
  world: World,
  kind: WalkerKind,
  school: Building,
  venue: Building,
): boolean {
  const destinations = new Set(roadAccessTiles(world.grid, venue));
  if (destinations.size === 0) return false;

  return spawnCarrier(world, kind, school, destinations, 0, 'food', venue.id);
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
  targetId = -1,
): boolean {
  const start = exitTile(world.grid, home);
  if (start === -1) return false;

  const route = bfsRoute(world.grid, start, (tile) => destinations.has(tile));
  if (!route) return false;

  world.addWalker({
    kind,
    homeId: home.id,
    targetId,
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
  if (PERFORMERS.includes(walker.kind) && walker.state === 'delivering' && atRouteEnd(walker)) {
    takeTheStage(world, walker);
    return;
  }

  if (walker.kind === 'superintendent') {
    if (walker.state !== 'delivering') maintainNeighbours(world, walker.from);
    return;
  }

  const service = walker.kind === 'peddler' ? SOLD_AS[walker.good] : WALKER_SERVICE[walker.kind];
  if (service) {
    if (walker.state === 'roaming' || walker.state === 'returning') serve(world, walker, service);
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

function maintainNeighbours(world: World, tile: number): void {
  for (const neighbour of world.grid.neighbours(tile)) {
    const building = world.buildingAt(neighbour);
    if (building) reassure(building);
  }
}

function serveAdjacentHouses(world: World, tile: number, service: ServiceKind): number {
  let served = 0;
  for (const neighbour of world.grid.neighbours(tile)) {
    const building = world.buildingAt(neighbour);
    if (!building || !isDwelling(building.kind)) continue;
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
    if (!store || !BUILDINGS[store.kind].accepts.includes(walker.good)) continue;
    store.stock[walker.good] = Math.min(BUILDINGS[store.kind].capacity, store.stock[walker.good] + walker.cargo);
    walker.cargo = 0;
    break;
  }
  turnBack(walker);
}

function takeTheStage(world: World, walker: Walker): void {
  world.rehouseWalker(walker, walker.targetId);
  walker.state = 'roaming';
  walker.route = [];
  walker.routeIndex = 0;
  walker.stepsLeft = ROAM_RANGE[walker.kind];
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
