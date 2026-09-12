import { describe, expect, test } from 'bun:test';
import { advance, build, createWorld } from './world';
import { buildStarterNeighbourhood } from './scenario';
import { buildServiceCircuit, exitTile } from './grid';
import { ROAD_BUDGET } from './balance';
import { deliveryRoutes, serviceRoute, walkerRoute, type DeliveryRoute } from './logistics';
import { connect, farCorner, homeTiles, spotFor } from './testing';
import { primaryCity } from './city';
import { islandFor, terrainOn } from './island';
import { GATHER_RANGE } from './gathering';
import type { Tile, Walker, WalkerKind, World } from './types';

function findByKind(world: World, kind: string) {
  return primaryCity(world).buildings.find((building) => building.kind === kind)!;
}

function advanceUntilWalker(world: World, kind: WalkerKind, maxSeconds = 2000): boolean {
  for (let elapsed = 0; elapsed < maxSeconds; elapsed += 1) {
    if (primaryCity(world).walkers.some((walker) => walker.kind === kind)) return true;
    advance(world, 1);
  }
  return primaryCity(world).walkers.some((walker) => walker.kind === kind);
}

describe('serviceRoute', () => {
  test('a disconnected building has no service route', () => {
    const world = createWorld();
    const spot = spotFor(world, 'fountain', farCorner(world))!;
    build(world, 'fountain', spot.x, spot.z);
    const fountain = findByKind(world, 'fountain');
    expect(fountain.connected).toBe(false);
    expect(serviceRoute(world, primaryCity(world), fountain)).toBeNull();
  });

  test('non-service building kinds have no route', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world).ok).toBe(true);
    expect(serviceRoute(world, primaryCity(world), findByKind(world, 'house'))).toBeNull();
    expect(serviceRoute(world, primaryCity(world), findByKind(world, 'granary'))).toBeNull();
  });

  test('an agora without an installed vendor has no route', () => {
    const world = createWorld();
    const spot = spotFor(world, 'agora')!;
    build(world, 'agora', spot.x, spot.z);
    const agora = findByKind(world, 'agora');
    expect(agora.connected).toBe(true);
    expect(serviceRoute(world, primaryCity(world), agora)).toBeNull();
  });

  test('an idle connected service building shows the planned circuit, shared with the road-planning algorithm', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world).ok).toBe(true);
    const fountain = findByKind(world, 'fountain');
    const route = serviceRoute(world, primaryCity(world), fountain);
    expect(route).not.toBeNull();
    expect(route!.live).toBe(false);
    const expected = buildServiceCircuit(world, primaryCity(world), exitTile(world, primaryCity(world), fountain), ROAD_BUDGET);
    expect(route!.path).toEqual(expected);
    const houseIds = primaryCity(world).buildings.filter((building) => building.kind === 'house').map((building) => building.id).sort();
    expect(route!.servedIds.sort()).toEqual(houseIds);
  });

  test('an active water carrier is reflected as its own live circuit', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world).ok).toBe(true);
    expect(advanceUntilWalker(world, 'water')).toBe(true);
    const fountain = findByKind(world, 'fountain');
    const walker = primaryCity(world).walkers.find((candidate) => candidate.kind === 'water' && candidate.homeId === fountain.id)!;
    const route = serviceRoute(world, primaryCity(world), fountain);
    expect(route).not.toBeNull();
    expect(route!.live).toBe(true);
    expect(route!.path).toEqual(walker.path);
  });

  test('a maintenance circuit serves workplaces as well as houses', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world).ok).toBe(true);
    expect(advanceUntilWalker(world, 'maintenance')).toBe(true);
    const maintenance = findByKind(world, 'maintenance');
    const route = serviceRoute(world, primaryCity(world), maintenance);
    expect(route).not.toBeNull();
    const servedKinds = new Set(route!.servedIds.map((id) => primaryCity(world).buildings.find((building) => building.id === id)!.kind));
    expect(servedKinds.has('house')).toBe(true);
    expect([...servedKinds].some((kind) => kind !== 'house')).toBe(true);
  });
});

function nearForest(world: World): Tile | null {
  for (const tree of homeTiles(world, (map, x, z) => terrainOn(map, x, z) === 'forest')) {
    const spot = spotFor(world, 'woodcutter', tree);
    if (spot && Math.abs(spot.x - tree.x) + Math.abs(spot.z - tree.z) < GATHER_RANGE / 2) return spot;
  }
  return null;
}

describe('deliveryRoutes', () => {
  test('non-supply-chain building kinds have no delivery routes', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world).ok).toBe(true);
    expect(deliveryRoutes(primaryCity(world), findByKind(world, 'house'))).toEqual([]);
    expect(deliveryRoutes(primaryCity(world), findByKind(world, 'fountain'))).toEqual([]);
  });

  test('a connected, idle farm shows no route: connectivity alone never implies a delivery', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world).ok).toBe(true);
    const farm = findByKind(world, 'farm');
    expect(farm.connected).toBe(true);
    expect(deliveryRoutes(primaryCity(world), farm)).toEqual([]);
  });

  test('a farm with an outgoing cart shows its actual in-flight path to the granary', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world).ok).toBe(true);
    const farm = findByKind(world, 'farm');
    const granary = findByKind(world, 'granary');
    let cart: Walker | undefined;
    for (let t = 0; t < 200 && !cart; t++) {
      advance(world, 1);
      cart = primaryCity(world).walkers.find((walker) => walker.kind === 'cart' && walker.homeId === farm.id);
    }
    expect(cart).toBeTruthy();
    const routes = deliveryRoutes(primaryCity(world), farm);
    expect(routes).toHaveLength(1);
    expect(routes[0].path).toEqual(cart!.path);
    expect(routes[0].otherId).toBe(granary.id);
    const fromGranary = deliveryRoutes(primaryCity(world), granary);
    expect(fromGranary).toHaveLength(1);
    expect(fromGranary[0].otherId).toBe(farm.id);
  });

  test('a granary shows an active buyer fetching food for the agora', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world).ok).toBe(true);
    const granary = findByKind(world, 'granary');
    const agora = findByKind(world, 'agora');
    let buyer: Walker | undefined;
    for (let t = 0; t < 1200 && !buyer; t++) {
      advance(world, .25);
      buyer = primaryCity(world).walkers.find((walker) => walker.kind === 'buyer' && walker.targetId === granary.id);
    }
    expect(buyer).toBeTruthy();
    const routes = deliveryRoutes(primaryCity(world), granary);
    expect(routes.some((route) => route.walkerId === buyer!.id && route.otherId === agora.id)).toBe(true);
  });

  test('a stockpile shows an incoming cart from a woodcutter', () => {
    const world = createWorld(1);
    const spot = nearForest(world)!;
    expect(spot).not.toBeNull();
    expect(build(world, 'woodcutter', spot.x, spot.z).ok).toBe(true);
    const woodcutter = primaryCity(world).buildings[0];
    expect(connect(world, woodcutter).ok).toBe(true);
    const pileSpot = spotFor(world, 'stockpile', spot)!;
    expect(build(world, 'stockpile', pileSpot.x, pileSpot.z).ok).toBe(true);
    const stockpile = primaryCity(world).buildings[1];
    expect(connect(world, stockpile).ok).toBe(true);
    const house = spotFor(world, 'house', islandFor(world.seed).entry)!;
    expect(build(world, 'house', house.x, house.z).ok).toBe(true);
    expect(connect(world, primaryCity(world).buildings[2]).ok).toBe(true);
    let route: DeliveryRoute | undefined;
    for (let t = 0; t < 1600 && !route; t++) {
      advance(world, .25);
      route = deliveryRoutes(primaryCity(world), stockpile).find((candidate) => candidate.otherId === woodcutter.id);
    }
    expect(route).toBeTruthy();
  });
});

describe('walkerRoute', () => {
  test('returns only the tiles still ahead of the walker', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world).ok).toBe(true);
    advance(world, 5);
    const walker = primaryCity(world).walkers[0];
    walker.step = Math.min(2, walker.path.length - 1);
    expect(walkerRoute(walker)).toEqual(walker.path.slice(walker.step));
  });
});
