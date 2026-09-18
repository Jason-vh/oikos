import { describe, expect, test } from 'bun:test';
import { advance, build, createWorld } from './world';
import { buildStarterNeighbourhood } from './scenario';
import { serviceCoverage, tradePartners, walkerDelivery } from './logistics';
import { connect, farCorner, homeTiles, spotFor } from './testing';
import { primaryCity } from './city';
import { islandFor, terrainOn } from './island';
import { GATHER_RANGE } from './gathering';
import type { Tile, Walker, WalkerKind, World } from './types';

function findByKind(world: World, kind: string) {
  return primaryCity(world).buildings.find((building) => building.kind === kind)!;
}

function kindOf(world: World, id: number): string {
  return primaryCity(world).buildings.find((building) => building.id === id)!.kind;
}

function ids(deliveries: { id: number }[]): number[] {
  return deliveries.map((delivery) => delivery.id).sort();
}

function advanceUntilWalker(world: World, kind: WalkerKind, maxSeconds = 2000): boolean {
  for (let elapsed = 0; elapsed < maxSeconds; elapsed += 1) {
    if (primaryCity(world).walkers.some((walker) => walker.kind === kind)) return true;
    advance(world, 1);
  }
  return primaryCity(world).walkers.some((walker) => walker.kind === kind);
}

describe('serviceCoverage', () => {
  test('a disconnected building covers nothing', () => {
    const world = createWorld();
    const spot = spotFor(world, 'fountain', farCorner(world))!;
    build(world, primaryCity(world), 'fountain', spot.x, spot.z);
    const fountain = findByKind(world, 'fountain');
    expect(fountain.connected).toBe(false);
    expect(serviceCoverage(world, primaryCity(world), fountain)).toEqual([]);
  });

  test('building kinds that send no circuit walker cover nothing', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world, primaryCity(world)).ok).toBe(true);
    expect(serviceCoverage(world, primaryCity(world), findByKind(world, 'house'))).toEqual([]);
    expect(serviceCoverage(world, primaryCity(world), findByKind(world, 'granary'))).toEqual([]);
  });

  test('an agora without an installed vendor covers nothing', () => {
    const world = createWorld();
    const spot = spotFor(world, 'agora')!;
    build(world, primaryCity(world), 'agora', spot.x, spot.z);
    const agora = findByKind(world, 'agora');
    expect(agora.connected).toBe(true);
    expect(serviceCoverage(world, primaryCity(world), agora)).toEqual([]);
  });

  test('a fountain covers the houses its circuit passes', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world, primaryCity(world)).ok).toBe(true);
    const fountain = findByKind(world, 'fountain');
    const houseIds = primaryCity(world).buildings.filter((building) => building.kind === 'house').map((building) => building.id).sort();
    expect(ids(serviceCoverage(world, primaryCity(world), fountain))).toEqual(houseIds);
    expect(serviceCoverage(world, primaryCity(world), fountain).every((delivery) => delivery.errand === 'water')).toBe(true);
  });

  test('coverage is the standing circuit, the same whether a carrier is out or not', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world, primaryCity(world)).ok).toBe(true);
    const fountain = findByKind(world, 'fountain');
    const idle = ids(serviceCoverage(world, primaryCity(world), fountain));
    expect(advanceUntilWalker(world, 'water')).toBe(true);
    expect(ids(serviceCoverage(world, primaryCity(world), fountain))).toEqual(idle);
  });

  test('a covered house that has run dry is marked unstocked', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world, primaryCity(world)).ok).toBe(true);
    const fountain = findByKind(world, 'fountain');
    for (const house of primaryCity(world).buildings.filter((building) => building.kind === 'house')) house.water = 0;
    expect(serviceCoverage(world, primaryCity(world), fountain).every((delivery) => !delivery.stocked)).toBe(true);
    for (const house of primaryCity(world).buildings.filter((building) => building.kind === 'house')) house.water = 10;
    expect(serviceCoverage(world, primaryCity(world), fountain).every((delivery) => delivery.stocked)).toBe(true);
  });

  test('a maintenance circuit covers workplaces as well as houses', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world, primaryCity(world)).ok).toBe(true);
    const maintenance = findByKind(world, 'maintenance');
    const covered = serviceCoverage(world, primaryCity(world), maintenance);
    expect(covered.every((delivery) => delivery.errand === 'repair')).toBe(true);
    const kinds = new Set(covered.map((delivery) => kindOf(world, delivery.id)));
    expect(kinds.has('house')).toBe(true);
    expect([...kinds].some((kind) => kind !== 'house')).toBe(true);
  });
});

function nearForest(world: World): Tile | null {
  for (const tree of homeTiles(world, (map, x, z) => terrainOn(map, x, z) === 'forest')) {
    const spot = spotFor(world, 'woodcutter', tree);
    if (spot && Math.abs(spot.x - tree.x) + Math.abs(spot.z - tree.z) < GATHER_RANGE / 2) return spot;
  }
  return null;
}

describe('tradePartners', () => {
  test('building kinds outside the supply chain have no partners', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world, primaryCity(world)).ok).toBe(true);
    expect(tradePartners(primaryCity(world), findByKind(world, 'house'))).toEqual([]);
    expect(tradePartners(primaryCity(world), findByKind(world, 'fountain'))).toEqual([]);
  });

  test('a connected, idle farm has no partners: connectivity alone never implies a delivery', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world, primaryCity(world)).ok).toBe(true);
    const farm = findByKind(world, 'farm');
    expect(farm.connected).toBe(true);
    expect(tradePartners(primaryCity(world), farm)).toEqual([]);
  });

  test('a farm with an outgoing cart pairs with the granary, and the granary with the farm', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world, primaryCity(world)).ok).toBe(true);
    const farm = findByKind(world, 'farm');
    const granary = findByKind(world, 'granary');
    let cart: Walker | undefined;
    for (let t = 0; t < 200 && !cart; t++) {
      advance(world, 1);
      cart = primaryCity(world).walkers.find((walker) => walker.kind === 'cart' && walker.homeId === farm.id);
    }
    expect(cart).toBeTruthy();
    expect(tradePartners(primaryCity(world), farm)).toEqual([{ id: granary.id, errand: 'goods', resource: cart!.food, stocked: true }]);
    expect(ids(tradePartners(primaryCity(world), granary))).toContain(farm.id);
  });

  test('a granary pairs with the agora a buyer is fetching for', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world, primaryCity(world)).ok).toBe(true);
    const granary = findByKind(world, 'granary');
    const agora = findByKind(world, 'agora');
    let buyer: Walker | undefined;
    for (let t = 0; t < 1200 && !buyer; t++) {
      advance(world, .25);
      buyer = primaryCity(world).walkers.find((walker) => walker.kind === 'buyer' && walker.targetId === granary.id);
    }
    expect(buyer).toBeTruthy();
    expect(ids(tradePartners(primaryCity(world), granary))).toContain(agora.id);
  });

  test('a stockpile pairs with the woodcutter carting lumber in', () => {
    const world = createWorld(1);
    const spot = nearForest(world)!;
    expect(spot).not.toBeNull();
    expect(build(world, primaryCity(world), 'woodcutter', spot.x, spot.z).ok).toBe(true);
    const woodcutter = primaryCity(world).buildings[0];
    expect(connect(world, woodcutter).ok).toBe(true);
    const pileSpot = spotFor(world, 'stockpile', spot)!;
    expect(build(world, primaryCity(world), 'stockpile', pileSpot.x, pileSpot.z).ok).toBe(true);
    const stockpile = primaryCity(world).buildings[1];
    expect(connect(world, stockpile).ok).toBe(true);
    const house = spotFor(world, 'house', islandFor(world.seed).entry)!;
    expect(build(world, primaryCity(world), 'house', house.x, house.z).ok).toBe(true);
    expect(connect(world, primaryCity(world).buildings[2]).ok).toBe(true);
    let paired = false;
    for (let t = 0; t < 1600 && !paired; t++) {
      advance(world, .25);
      paired = ids(tradePartners(primaryCity(world), stockpile)).includes(woodcutter.id);
    }
    expect(paired).toBe(true);
  });
});

describe('walkerDelivery', () => {
  test('a walker on a circuit has no single destination to name', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world, primaryCity(world)).ok).toBe(true);
    expect(advanceUntilWalker(world, 'water')).toBe(true);
    const carrier = primaryCity(world).walkers.find((walker) => walker.kind === 'water')!;
    expect(carrier.targetId).toBeNull();
    expect(walkerDelivery(carrier)).toBeNull();
  });

  test('a cart names its cargo; a walker on nobody\'s errand names nothing', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world, primaryCity(world)).ok).toBe(true);
    const farm = findByKind(world, 'farm');
    let cart: Walker | undefined;
    for (let t = 0; t < 200 && !cart; t++) {
      advance(world, 1);
      cart = primaryCity(world).walkers.find((walker) => walker.kind === 'cart' && walker.homeId === farm.id);
    }
    expect(walkerDelivery(cart!)).toEqual({ id: cart!.targetId!, errand: 'goods', resource: cart!.food, stocked: true });
    expect(walkerDelivery({ ...cart!, kind: 'immigrant' })).toBeNull();
  });
});
