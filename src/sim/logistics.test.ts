import { describe, expect, test } from 'bun:test';
import { advance, build, createWorld } from './world';
import { buildStarterNeighbourhood } from './scenario';
import { buildServiceCircuit, exitTile } from './grid';
import { ROAD_BUDGET } from './balance';
import { serviceRoute, walkerRoute } from './logistics';
import { farCorner, spotFor } from './testing';
import type { WalkerKind, World } from './types';

function findByKind(world: World, kind: string) {
  return world.buildings.find((building) => building.kind === kind)!;
}

function advanceUntilWalker(world: World, kind: WalkerKind, maxSeconds = 2000): boolean {
  for (let elapsed = 0; elapsed < maxSeconds; elapsed += 1) {
    if (world.walkers.some((walker) => walker.kind === kind)) return true;
    advance(world, 1);
  }
  return world.walkers.some((walker) => walker.kind === kind);
}

describe('serviceRoute', () => {
  test('a disconnected building has no service route', () => {
    const world = createWorld();
    const spot = spotFor(world, 'fountain', farCorner(world))!;
    build(world, 'fountain', spot.x, spot.z);
    const fountain = findByKind(world, 'fountain');
    expect(fountain.connected).toBe(false);
    expect(serviceRoute(world, fountain)).toBeNull();
  });

  test('non-service building kinds have no route', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world).ok).toBe(true);
    expect(serviceRoute(world, findByKind(world, 'house'))).toBeNull();
    expect(serviceRoute(world, findByKind(world, 'granary'))).toBeNull();
  });

  test('an agora without an installed vendor has no route', () => {
    const world = createWorld();
    const spot = spotFor(world, 'agora')!;
    build(world, 'agora', spot.x, spot.z);
    const agora = findByKind(world, 'agora');
    expect(agora.connected).toBe(true);
    expect(serviceRoute(world, agora)).toBeNull();
  });

  test('an idle connected service building shows the planned circuit, shared with the road-planning algorithm', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world).ok).toBe(true);
    const fountain = findByKind(world, 'fountain');
    const route = serviceRoute(world, fountain);
    expect(route).not.toBeNull();
    expect(route!.live).toBe(false);
    const expected = buildServiceCircuit(world, exitTile(world, fountain), ROAD_BUDGET);
    expect(route!.path).toEqual(expected);
    const houseIds = world.buildings.filter((building) => building.kind === 'house').map((building) => building.id).sort();
    expect(route!.servedIds.sort()).toEqual(houseIds);
  });

  test('an active water carrier is reflected as its own live circuit', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world).ok).toBe(true);
    expect(advanceUntilWalker(world, 'water')).toBe(true);
    const fountain = findByKind(world, 'fountain');
    const walker = world.walkers.find((candidate) => candidate.kind === 'water' && candidate.homeId === fountain.id)!;
    const route = serviceRoute(world, fountain);
    expect(route).not.toBeNull();
    expect(route!.live).toBe(true);
    expect(route!.path).toEqual(walker.path);
  });

  test('a maintenance circuit serves workplaces as well as houses', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world).ok).toBe(true);
    expect(advanceUntilWalker(world, 'maintenance')).toBe(true);
    const maintenance = findByKind(world, 'maintenance');
    const route = serviceRoute(world, maintenance);
    expect(route).not.toBeNull();
    const servedKinds = new Set(route!.servedIds.map((id) => world.buildings.find((building) => building.id === id)!.kind));
    expect(servedKinds.has('house')).toBe(true);
    expect([...servedKinds].some((kind) => kind !== 'house')).toBe(true);
  });
});

describe('walkerRoute', () => {
  test('returns only the tiles still ahead of the walker', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world).ok).toBe(true);
    advance(world, 5);
    const walker = world.walkers[0];
    walker.step = Math.min(2, walker.path.length - 1);
    expect(walkerRoute(walker)).toEqual(walker.path.slice(walker.step));
  });
});
