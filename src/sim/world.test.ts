import { describe, expect, test } from 'bun:test';
import { advance, build, buildingStatus, createWorld, demolish, getSummary, placeRoadPath, placement, roadPathPlacement, setVendor } from './world';
import { buildStarterNeighbourhood, planStarterNeighbourhood } from './scenario';
import { BUILDINGS, ROAD_COST, STARTING_MONEY, VENDOR_COST } from './catalog';
import { generateIsland, islandFor, terrainOn, tileAtOn, tileIndexOn, type IslandMap } from './island';
import { accessDoors, bfsShortest, entryTileIndex, exitTile } from './grid';
import { connect, farCorner, findTile, freshRoadSpot, isolatedRoadPair, mapOf, slopeFixture, spotAdjacentTo, spotFor, unevenFootprint, SLOPE_SEED } from './testing';
import { primaryCity } from './city';
import type { Building, BuildingKind, Tile, Walker, World } from './types';

function findByKind(world: World, kind: string) {
  return primaryCity(world).buildings.find((building) => building.kind === kind)!;
}

describe('placement validation', () => {
  test('rejects out of bounds', () => {
    const world = createWorld();
    const result = placement(world, primaryCity(world), 'house', 1000, 1000);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Out of bounds.');
  });

  test('farms require fertile ground', () => {
    const world = createWorld();
    const nonFertile = findTile(world, (map, x, z) => ['grass', 'sand', 'scrub'].includes(terrainOn(map, x, z)));
    const onOther = placement(world, primaryCity(world), 'farm', nonFertile!.x, nonFertile!.z);
    expect(onOther.ok).toBe(false);
    expect(onOther.reason).toBe('Farms need fertile ground.');

    const fertileSpot = spotFor(world, 'farm')!;
    const onFertile = placement(world, primaryCity(world), 'farm', fertileSpot.x, fertileSpot.z);
    expect(onFertile.ok).toBe(true);
    expect(onFertile.cost).toBe(BUILDINGS.farm.cost);
  });

  test('rejects cliff and water terrain for ordinary buildings', () => {
    const world = createWorld();
    const cliff = findTile(world, (map, x, z) => terrainOn(map, x, z) === 'cliff')!;
    const onCliff = placement(world, primaryCity(world), 'house', cliff.x, cliff.z);
    expect(onCliff.ok).toBe(false);
    expect(onCliff.reason).toBe('Unsuitable terrain.');

    const water = findTile(world, (map, x, z) => terrainOn(map, x, z) === 'water')!;
    const onWater = placement(world, primaryCity(world), 'house', water.x, water.z);
    expect(onWater.ok).toBe(false);
    expect(onWater.reason).toBe('Unsuitable terrain.');
  });

  test('rejects uneven footprints', () => {
    const world = createWorld();
    const spot = unevenFootprint(world, 'house')!;
    const result = placement(world, primaryCity(world), 'house', spot.x, spot.z);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Buildings need level ground.');
  });

  test('reports insufficient funds without mutating money', () => {
    const world = createWorld();
    const spot = spotFor(world, 'farm')!;
    primaryCity(world).money = 10;
    const result = placement(world, primaryCity(world), 'farm', spot.x, spot.z);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Not enough drachmas.');
    expect(result.cost).toBe(BUILDINGS.farm.cost);
    expect(primaryCity(world).money).toBe(10);
  });

  test('rejects overlapping buildings and building-on-road', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    expect(build(world, primaryCity(world), 'house', spot.x, spot.z).ok).toBe(true);
    expect(placement(world, primaryCity(world), 'house', spot.x + 1, spot.z + 1).ok).toBe(false);

    const overlapX = mapOf(world).entry.x - 1;
    const overlapZ = mapOf(world).entry.z - 4;
    expect(placement(world, primaryCity(world), 'house', overlapX, overlapZ).reason).toBe('That tile is occupied by a road.');
  });

  test('rejects roads on top of buildings', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, primaryCity(world), 'house', spot.x, spot.z);
    const result = placement(world, primaryCity(world), 'road', spot.x + 1, spot.z + 1);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('That tile is occupied.');
  });

  test('rejects roads that step between levels', () => {
    const { low, high } = slopeFixture();
    const world = createWorld(SLOPE_SEED);
    expect(build(world, primaryCity(world), 'road', low.x, low.z).ok).toBe(true);
    const result = placement(world, primaryCity(world), 'road', high.x, high.z);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Roads climb only one step at a time, across the cliff edge.');
  });

  test('roads climb one level where they cross a cliff edge', () => {
    const { low, high } = slopeFixture();
    const map = islandFor(SLOPE_SEED);
    map.terrain[tileIndexOn(map, high.x, high.z)] = 'cliff';
    const world = createWorld(SLOPE_SEED);
    expect(build(world, primaryCity(world), 'road', low.x, low.z).ok).toBe(true);
    expect(placement(world, primaryCity(world), 'road', high.x, high.z).ok).toBe(true);
    expect(placeRoadPath(world, primaryCity(world), [low, high]).ok).toBe(true);
    map.terrain[tileIndexOn(map, high.x, high.z)] = 'grass';
  });

  test('a single-tile stroke agrees with placement: both reject a bad grade against an existing neighbour', () => {
    const { low, high } = slopeFixture();
    const worldA = createWorld(SLOPE_SEED);
    expect(build(worldA, primaryCity(worldA), 'road', low.x, low.z).ok).toBe(true);
    const singlePlacement = placement(worldA, primaryCity(worldA), 'road', high.x, high.z);
    expect(singlePlacement.ok).toBe(false);
    expect(singlePlacement.reason).toBe('Roads climb only one step at a time, across the cliff edge.');

    const worldB = createWorld(SLOPE_SEED);
    expect(build(worldB, primaryCity(worldB), 'road', low.x, low.z).ok).toBe(true);
    const strokePreview = roadPathPlacement(worldB, primaryCity(worldB), [high]);
    expect(strokePreview.ok).toBe(false);
    expect(strokePreview.reason).toBe('Roads climb only one step at a time, across the cliff edge.');
    const strokeResult = placeRoadPath(worldB, primaryCity(worldB), [high]);
    expect(strokeResult.ok).toBe(false);
    expect(strokeResult.reason).toBe('Roads climb only one step at a time, across the cliff edge.');
    expect(primaryCity(worldB).roads.includes(tileIndexOn(mapOf(worldB), high.x, high.z))).toBe(false);
  });
});

describe('build costs', () => {
  test('deducts cost on success', () => {
    const world = createWorld();
    const spot = spotFor(world, 'farm')!;
    const before = primaryCity(world).money;
    const result = build(world, primaryCity(world), 'farm', spot.x, spot.z);
    expect(result.ok).toBe(true);
    expect(primaryCity(world).money).toBe(before - BUILDINGS.farm.cost);
  });

  test('already-present roads cost nothing again', () => {
    const world = createWorld();
    const spot = freshRoadSpot(world)!;
    const first = build(world, primaryCity(world), 'road', spot.x, spot.z);
    expect(first.ok).toBe(true);
    const spent = STARTING_MONEY - primaryCity(world).money;
    expect(spent).toBe(ROAD_COST);

    const again = build(world, primaryCity(world), 'road', spot.x, spot.z);
    expect(again.ok).toBe(true);
    expect(STARTING_MONEY - primaryCity(world).money).toBe(spent);
  });

  test('placeRoadPath is atomic and only charges new tiles', () => {
    const world = createWorld();
    const map = mapOf(world);
    const [a, b] = isolatedRoadPair(world, map.entry)!;
    const before = primaryCity(world).money;
    const badPath = [a, b, { x: 1000, z: 1000 }];
    const result = placeRoadPath(world, primaryCity(world), badPath);
    expect(result.ok).toBe(false);
    expect(primaryCity(world).money).toBe(before);
    expect(primaryCity(world).roads.includes(tileIndexOn(map, a.x, a.z))).toBe(false);

    const goodPath = [{ x: map.entry.x, z: map.entry.z }, a, b];
    const ok = placeRoadPath(world, primaryCity(world), goodPath);
    expect(ok.ok).toBe(true);
    expect(before - primaryCity(world).money).toBe(ROAD_COST * 2);
  });

  test('rejects a road path that climbs between levels', () => {
    const { low, high } = slopeFixture();
    const world = createWorld(SLOPE_SEED);
    const result = placeRoadPath(world, primaryCity(world), [low, high]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Roads climb only one step at a time, across the cliff edge.');
  });

  test('a cliff only on the lower tile still refuses the climb', () => {
    const { low, high } = slopeFixture();
    const map = islandFor(SLOPE_SEED);
    map.terrain[tileIndexOn(map, low.x, low.z)] = 'cliff';
    const world = createWorld(SLOPE_SEED);
    expect(build(world, primaryCity(world), 'road', low.x, low.z).ok).toBe(true);
    const result = placement(world, primaryCity(world), 'road', high.x, high.z);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Roads climb only one step at a time, across the cliff edge.');
    map.terrain[tileIndexOn(map, low.x, low.z)] = 'grass';
  });
});

describe('demolition', () => {
  test('demolishing an empty tile fails', () => {
    const world = createWorld();
    const result = demolish(world, primaryCity(world), 0, 0);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Nothing to demolish there.');
  });

  test('removes a building and refunds half its cost', () => {
    const world = createWorld();
    const spot = spotFor(world, 'farm')!;
    build(world, primaryCity(world), 'farm', spot.x, spot.z);
    const beforeDemolish = primaryCity(world).money;
    expect(primaryCity(world).buildings.length).toBe(1);
    const result = demolish(world, primaryCity(world), spot.x, spot.z);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe(`Demolished, ${Math.floor(BUILDINGS.farm.cost / 2)} drachmas refunded.`);
    expect(primaryCity(world).buildings.length).toBe(0);
    expect(primaryCity(world).money).toBe(beforeDemolish + Math.floor(BUILDINGS.farm.cost / 2));
  });

  test('refunds an installed vendor along with the agora', () => {
    const world = createWorld();
    const spot = spotFor(world, 'agora')!;
    build(world, primaryCity(world), 'agora', spot.x, spot.z);
    const agora = findByKind(world, 'agora');
    setVendor(primaryCity(world), agora.id, true);
    const beforeDemolish = primaryCity(world).money;
    const expected = Math.floor((BUILDINGS.agora.cost + VENDOR_COST) / 2);
    const result = demolish(world, primaryCity(world), spot.x, spot.z);
    expect(result.ok).toBe(true);
    expect(primaryCity(world).money).toBe(beforeDemolish + expected);
  });

  test('removes a road tile with no refund', () => {
    const world = createWorld();
    const map = mapOf(world);
    const roadIndex = primaryCity(world).roads[0];
    const road = tileAtOn(map, roadIndex);
    const beforeDemolish = primaryCity(world).money;
    const result = demolish(world, primaryCity(world), road.x, road.z);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('Demolished. Roads are not refunded.');
    expect(primaryCity(world).roads.includes(roadIndex)).toBe(false);
    expect(primaryCity(world).money).toBe(beforeDemolish);
  });

  test('cannot profit by paving and immediately demolishing a road', () => {
    const world = createWorld();
    const spot = freshRoadSpot(world)!;
    const before = primaryCity(world).money;
    build(world, primaryCity(world), 'road', spot.x, spot.z);
    demolish(world, primaryCity(world), spot.x, spot.z);
    expect(primaryCity(world).money).toBe(before - ROAD_COST);
  });

  test('demolishing a starter road never yields a refund', () => {
    const world = createWorld();
    const map = mapOf(world);
    const road = tileAtOn(map, primaryCity(world).roads[0]);
    const before = primaryCity(world).money;
    demolish(world, primaryCity(world), road.x, road.z);
    expect(primaryCity(world).money).toBe(before);
  });
});

describe('valid placements need no reason text', () => {
  test('placement leaves reason empty on success', () => {
    const world = createWorld();
    const farmSpot = spotFor(world, 'farm')!;
    const roadSpot = spotFor(world, 'road')!;
    expect(placement(world, primaryCity(world), 'farm', farmSpot.x, farmSpot.z).reason).toBe('');
    expect(placement(world, primaryCity(world), 'road', roadSpot.x, roadSpot.z).reason).toBe('');
  });
});

describe('failure reasons are full sentences', () => {
  test('matches the agreed phrasing for common failures', () => {
    const world = createWorld();
    const farmSpot = spotFor(world, 'farm')!;
    const nonFertile = findTile(world, (map, x, z) => ['grass', 'sand', 'scrub'].includes(terrainOn(map, x, z)))!;
    primaryCity(world).money = 10;
    expect(placement(world, primaryCity(world), 'farm', farmSpot.x, farmSpot.z).reason).toBe('Not enough drachmas.');
    expect(placement(world, primaryCity(world), 'farm', nonFertile.x, nonFertile.z).reason).toBe('Farms need fertile ground.');
    expect(placement(world, primaryCity(world), 'house', 1000, 1000).reason).toBe('Out of bounds.');
  });
});

describe('human-readable action results', () => {
  test('build reports what was built', () => {
    const world = createWorld();
    const houseSpot = spotFor(world, 'house')!;
    const roadSpot = spotFor(world, 'road')!;
    expect(build(world, primaryCity(world), 'house', houseSpot.x, houseSpot.z).reason).toBe('Dwelling built.');
    expect(build(world, primaryCity(world), 'road', roadSpot.x, roadSpot.z).reason).toBe('Road laid.');
  });

  test('setVendor reports install, enable and disable distinctly', () => {
    const world = createWorld();
    const spot = spotFor(world, 'agora')!;
    build(world, primaryCity(world), 'agora', spot.x, spot.z);
    const agora = findByKind(world, 'agora');
    expect(setVendor(primaryCity(world), agora.id, true).reason).toBe('Food vendor added.');
    expect(setVendor(primaryCity(world), agora.id, true).reason).toBe('Vendor already active.');
    expect(setVendor(primaryCity(world), agora.id, false).reason).toBe('Vendor paused.');
    expect(setVendor(primaryCity(world), agora.id, true).reason).toBe('Vendor resumed.');
  });
});

describe('connectivity', () => {
  test('disconnected placement succeeds but is flagged', () => {
    const world = createWorld();
    const spot = spotFor(world, 'farm', farCorner(world))!;
    const result = build(world, primaryCity(world), 'farm', spot.x, spot.z);
    expect(result.ok).toBe(true);
    const farm = findByKind(world, 'farm');
    expect(farm.connected).toBe(false);
    expect(buildingStatus(primaryCity(world), farm)).toEqual(['Not linked to a road; nobody can reach it.']);
  });

  test('a road island that does not reach the entry is not connected', () => {
    const world = createWorld();
    const pair = isolatedRoadPair(world, farCorner(world))!;
    placeRoadPath(world, primaryCity(world), pair);
    const spot = spotAdjacentTo(world, 'house', pair[1])!;
    const result = build(world, primaryCity(world), 'house', spot.x, spot.z);
    expect(result.ok).toBe(true);
    const house = findByKind(world, 'house');
    expect(house.connected).toBe(false);
  });

  test('touching the starter road network connects a building', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, primaryCity(world), 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    if (!house.connected) connect(world, house);
    expect(house.connected).toBe(true);
  });
});

describe('vendor enablement', () => {
  test('charges once, and re-enabling does not charge again', () => {
    const world = createWorld();
    const spot = spotFor(world, 'agora')!;
    build(world, primaryCity(world), 'agora', spot.x, spot.z);
    const agora = findByKind(world, 'agora');
    const before = primaryCity(world).money;

    expect(setVendor(primaryCity(world), agora.id, true).ok).toBe(true);
    expect(before - primaryCity(world).money).toBe(VENDOR_COST);

    expect(setVendor(primaryCity(world), agora.id, false).ok).toBe(true);
    expect(setVendor(primaryCity(world), agora.id, true).ok).toBe(true);
    expect(before - primaryCity(world).money).toBe(VENDOR_COST);
  });

  test('rejects vendor on a non-agora building', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, primaryCity(world), 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    const result = setVendor(primaryCity(world), house.id, true);
    expect(result.ok).toBe(false);
  });

  test('rejects enabling without funds for the first install', () => {
    const world = createWorld();
    const spot = spotFor(world, 'agora')!;
    build(world, primaryCity(world), 'agora', spot.x, spot.z);
    const agora = findByKind(world, 'agora');
    primaryCity(world).money = 0;
    const result = setVendor(primaryCity(world), agora.id, true);
    expect(result.ok).toBe(false);
    expect(agora.vendorInstalled).toBe(false);
  });
});

describe('labour', () => {
  test('workplaces have no workers with no population', () => {
    const world = createWorld();
    const spot = spotFor(world, 'farm')!;
    build(world, primaryCity(world), 'farm', spot.x, spot.z);
    advance(world, 5);
    const farm = findByKind(world, 'farm');
    expect(farm.workers).toBe(0);
  });

  test('disconnected workplaces never receive workers even with population available', () => {
    const world = createWorld();
    const houseSpot = spotFor(world, 'house')!;
    build(world, primaryCity(world), 'house', houseSpot.x, houseSpot.z);
    const farmSpot = spotFor(world, 'farm', farCorner(world))!;
    build(world, primaryCity(world), 'farm', farmSpot.x, farmSpot.z);
    advance(world, 60);
    const farm = findByKind(world, 'farm');
    expect(farm.connected).toBe(false);
    expect(farm.workers).toBe(0);
  });

  test('employment is roughly half of population, split across jobs', () => {
    const world = createWorld();
    buildStarterNeighbourhood(world, primaryCity(world));
    advance(world, 30);
    const summary = getSummary(primaryCity(world));
    expect(summary.workers).toBeGreaterThan(0);
    expect(summary.workers).toBeLessThanOrEqual(summary.jobs);
  });
});

describe('the full supply chain', () => {
  test('reaches first food well under 90 seconds and a tier upgrade under 240 seconds', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world, primaryCity(world)).ok).toBe(true);

    let firstFoodAt: number | null = null;
    let firstUpgradeAt: number | null = null;
    for (let i = 0; i < 400 && (firstFoodAt === null || firstUpgradeAt === null); i++) {
      advance(world, 1);
      const houses = primaryCity(world).buildings.filter((building) => building.kind === 'house');
      if (firstFoodAt === null && houses.some((house) => house.food > 0)) firstFoodAt = world.time;
      if (firstUpgradeAt === null && houses.some((house) => house.tier > 1)) firstUpgradeAt = world.time;
    }

    expect(firstFoodAt).not.toBeNull();
    expect(firstFoodAt as number).toBeLessThan(90);
    expect(firstUpgradeAt).not.toBeNull();
    expect(firstUpgradeAt as number).toBeLessThan(240);
  });

  test('the recommended neighbourhood becomes sustainable and reaches the goal', () => {
    const world = createWorld();
    buildStarterNeighbourhood(world, primaryCity(world));
    advance(world, 300);
    const summary = getSummary(primaryCity(world));
    expect(summary.goal).toBe(true);
    expect(summary.balance).toBeGreaterThanOrEqual(0);
    expect(primaryCity(world).produced).toBeGreaterThan(0);
    expect(primaryCity(world).delivered).toBeGreaterThan(0);
  });

  test('sustains for 10+ simulated minutes without instability', () => {
    const world = createWorld();
    buildStarterNeighbourhood(world, primaryCity(world));
    advance(world, 700);
    const summary = getSummary(primaryCity(world));
    expect(Number.isFinite(primaryCity(world).money)).toBe(true);
    expect(Number.isFinite(summary.population)).toBe(true);
    expect(summary.population).toBeGreaterThan(0);
    expect(summary.goal).toBe(true);
    for (const building of primaryCity(world).buildings) {
      expect(Number.isFinite(building.food)).toBe(true);
      expect(Number.isFinite(building.water)).toBe(true);
      expect(building.condition).toBeGreaterThanOrEqual(0);
      expect(building.condition).toBeLessThanOrEqual(100);
    }
  });
});

describe('water and maintenance', () => {
  test('a fountain fills the water of houses it passes', () => {
    const world = createWorld();
    buildStarterNeighbourhood(world, primaryCity(world));
    advance(world, 200);
    const houses = primaryCity(world).buildings.filter((building) => building.kind === 'house' && building.tier === 3);
    expect(houses.length).toBeGreaterThan(0);
    for (const house of houses) expect(house.water).toBeGreaterThan(0);
  });

  test('condition decays without maintenance and is repaired with it', () => {
    const isolated = createWorld();
    const spot = spotFor(isolated, 'house')!;
    build(isolated, primaryCity(isolated), 'house', spot.x, spot.z);
    advance(isolated, 1200);
    const lonelyHouse = findByKind(isolated, 'house');
    expect(lonelyHouse.condition).toBeLessThan(100);

    const maintained = createWorld();
    buildStarterNeighbourhood(maintained, primaryCity(maintained));
    advance(maintained, 1200);
    for (const building of primaryCity(maintained).buildings) {
      expect(building.condition).toBeGreaterThan(90);
    }
  });
});

describe('housing grace and devolution', () => {
  test('a tier-2 house devolves after sustained food loss beyond the grace period', () => {
    const world = createWorld();
    buildStarterNeighbourhood(world, primaryCity(world));
    advance(world, 90);
    const house = primaryCity(world).buildings.find((building) => building.kind === 'house' && building.tier >= 2)!;
    expect(house).toBeTruthy();
    const startingTier = house.tier;

    const agora = findByKind(world, 'agora');
    setVendor(primaryCity(world), agora.id, false);
    primaryCity(world).walkers = primaryCity(world).walkers.filter((walker) => walker.kind !== 'vendor');
    house.food = 0;

    advance(world, 44);
    expect(house.tier).toBe(startingTier);

    advance(world, 5);
    expect(house.tier).toBe((startingTier - 1) as 1 | 2 | 3);
  });
});

describe('road breaks and demolition cargo', () => {
  test('cutting the road under an in-flight walker drops it without corrupting stock', () => {
    const world = createWorld();
    buildStarterNeighbourhood(world, primaryCity(world));
    advance(world, 5);
    expect(primaryCity(world).walkers.length).toBeGreaterThan(0);

    const map = mapOf(world);
    const walker = primaryCity(world).walkers[0];
    const midTile = walker.path[Math.floor(walker.path.length / 2)];
    for (const road of [...primaryCity(world).roads]) {
      if (road === midTile) {
        const { x, z } = tileAtOn(map, road);
        demolish(world, primaryCity(world), x, z);
        break;
      }
    }

    expect(() => advance(world, 100)).not.toThrow();
    for (const building of primaryCity(world).buildings) {
      for (const amount of Object.values(building.stores)) {
        expect(amount).toBeGreaterThan(0);
        expect(Number.isFinite(amount)).toBe(true);
      }
    }
  });

  test('demolishing a cart target reverses the walker instead of corrupting supplies', () => {
    const world = createWorld();
    buildStarterNeighbourhood(world, primaryCity(world));
    advance(world, 5);
    const cart = primaryCity(world).walkers.find((walker) => walker.kind === 'cart');
    if (!cart) return;
    const granary = findByKind(world, 'granary');
    demolish(world, primaryCity(world), granary.x, granary.z);
    const updated = primaryCity(world).walkers.find((walker) => walker.id === cart.id);
    if (updated) {
      expect(updated.targetId).toBeNull();
      expect(updated.returning).toBe(true);
    }
    expect(() => advance(world, 30)).not.toThrow();
  });

  test('demolishing a cart source removes it cleanly', () => {
    const world = createWorld();
    buildStarterNeighbourhood(world, primaryCity(world));
    advance(world, 5);
    const cart = primaryCity(world).walkers.find((walker) => walker.kind === 'cart');
    if (!cart) return;
    const farm = findByKind(world, 'farm');
    demolish(world, primaryCity(world), farm.x, farm.z);
    expect(primaryCity(world).walkers.some((walker) => walker.id === cart.id)).toBe(false);
    expect(() => advance(world, 30)).not.toThrow();
  });
});

describe('determinism', () => {
  test('advancing in one big step matches many small steps', () => {
    const worldA = createWorld();
    buildStarterNeighbourhood(worldA, primaryCity(worldA));
    const worldB = createWorld();
    buildStarterNeighbourhood(worldB, primaryCity(worldB));

    advance(worldA, 123);
    for (let i = 0; i < 123; i++) advance(worldB, 1);

    expect(worldA.time).toBe(worldB.time);
    expect(primaryCity(worldA).money).toBeCloseTo(primaryCity(worldB).money, 6);
    expect(primaryCity(worldA).produced).toBe(primaryCity(worldB).produced);
    expect(primaryCity(worldA).delivered).toBeCloseTo(primaryCity(worldB).delivered, 6);
    expect(primaryCity(worldA).buildings).toEqual(primaryCity(worldB).buildings);
  });

  test('sub-step remainders accumulate correctly', () => {
    const world = createWorld();
    advance(world, 0.1);
    expect(world.time).toBe(0);
    expect(world.remainder).toBeCloseTo(0.1, 10);
    advance(world, 0.4);
    expect(world.time).toBeCloseTo(0.5, 10);
    expect(world.remainder).toBeCloseTo(0, 10);
  });
});

describe('player-facing building status', () => {
  test('a disconnected building only says so', () => {
    const world = createWorld();
    const spot = spotFor(world, 'farm', farCorner(world))!;
    build(world, primaryCity(world), 'farm', spot.x, spot.z);
    const farm = findByKind(world, 'farm');
    expect(buildingStatus(primaryCity(world), farm)).toEqual(['Not linked to a road; nobody can reach it.']);
  });

  test('an empty connected house is waiting for settlers', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, primaryCity(world), 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    expect(buildingStatus(primaryCity(world), house)).toEqual(['Waiting for settlers from the harbour.']);
  });

  test('a full tier-1 house without food is blocked from growing', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, primaryCity(world), 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    house.residents = 8;
    expect(buildingStatus(primaryCity(world), house)).toEqual(['Needs food to grow: add an agora vendor nearby.']);
  });

  test('a full, fed tier-2 house without water cannot become a courtyard house', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, primaryCity(world), 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    house.tier = 2;
    house.residents = 12;
    house.food = 10;
    house.water = 0;
    expect(buildingStatus(primaryCity(world), house)).toEqual(['Needs water to become a courtyard house.']);
  });

  test('a tier-2 house that has run out of food is in distress, not just growth-blocked', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, primaryCity(world), 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    house.tier = 2;
    house.residents = 5;
    house.food = 0;
    expect(buildingStatus(primaryCity(world), house)).toEqual(['Out of food; a vendor visit is needed.']);
  });

  test('a tier-3 house that has run dry needs water, not food', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, primaryCity(world), 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    house.tier = 3;
    house.residents = 15;
    house.food = 5;
    house.water = 0;
    expect(buildingStatus(primaryCity(world), house)).toEqual(['Out of water; a fountain visit is needed.']);
  });

  test('a full, satisfied tier-3 house is described as thriving', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, primaryCity(world), 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    house.tier = 3;
    house.residents = 20;
    house.food = 5;
    house.water = 5;
    expect(buildingStatus(primaryCity(world), house)).toEqual(['A thriving courtyard house.']);
  });

  test('low condition adds a neglect warning alongside the primary line', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, primaryCity(world), 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    house.tier = 3;
    house.residents = 20;
    house.food = 5;
    house.water = 5;
    house.condition = 20;
    expect(buildingStatus(primaryCity(world), house)).toEqual(['A thriving courtyard house.', 'Neglected; build a maintenance post.']);
    const maintenanceSpot = spotFor(world, 'maintenance')!;
    build(world, primaryCity(world), 'maintenance', maintenanceSpot.x, maintenanceSpot.z);
    connect(world, findByKind(world, 'maintenance'));
    expect(buildingStatus(primaryCity(world), house).at(-1)).toBe('Neglected; a caretaker will repair it.');
  });

  test('an unstaffed workplace says so before anything else', () => {
    const world = createWorld();
    const spot = spotFor(world, 'farm')!;
    build(world, primaryCity(world), 'farm', spot.x, spot.z);
    const farm = findByKind(world, 'farm');
    farm.connected = true;
    expect(buildingStatus(primaryCity(world), farm)).toEqual(['Unstaffed; settlers are needed for work.']);
    farm.workers = 2;
    expect(buildingStatus(primaryCity(world), farm)).toEqual(['Short of workers; more settlers are needed.']);
  });

  test('a staffed farm reports harvest progress', () => {
    const world = createWorld();
    const spot = spotFor(world, 'farm')!;
    build(world, primaryCity(world), 'farm', spot.x, spot.z);
    const farm = findByKind(world, 'farm');
    farm.connected = true;
    farm.workers = BUILDINGS.farm.jobs;
    farm.progress = 0.4;
    expect(buildingStatus(primaryCity(world), farm)).toEqual(['Growing wheat, 40% to harvest.']);
  });

  test('an empty granary is waiting for a cart, a stocked one is ready', () => {
    const world = createWorld();
    const spot = spotFor(world, 'granary')!;
    build(world, primaryCity(world), 'granary', spot.x, spot.z);
    const granary = findByKind(world, 'granary');
    granary.workers = BUILDINGS.granary.jobs;
    expect(buildingStatus(primaryCity(world), granary)).toEqual(['Empty; waiting for a farm cart.']);
    granary.stores.wheat = 50;
    expect(buildingStatus(primaryCity(world), granary)).toEqual(['Stocked and ready for buyers.']);
  });

  test('an agora without a vendor asks for one', () => {
    const world = createWorld();
    const spot = spotFor(world, 'agora')!;
    build(world, primaryCity(world), 'agora', spot.x, spot.z);
    const agora = findByKind(world, 'agora');
    agora.workers = BUILDINGS.agora.jobs;
    expect(buildingStatus(primaryCity(world), agora)).toEqual(['Add a food vendor to start deliveries.']);
  });

  test('an installed but idle vendor is resting, an active one is on the streets', () => {
    const world = createWorld();
    buildStarterNeighbourhood(world, primaryCity(world));
    const agora = findByKind(world, 'agora');

    let sawResting = false;
    let sawActive = false;
    for (let i = 0; i < 300 && !(sawResting && sawActive); i++) {
      advance(world, 1);
      const line = buildingStatus(primaryCity(world), agora)[0];
      if (line === 'Vendor resting at market.') sawResting = true;
      if (line === 'Vendor on the streets.') sawActive = true;
    }
    expect(sawResting).toBe(true);
    expect(sawActive).toBe(true);
  });
});

describe('scenario helper', () => {
  test('plans a four-house neighbourhood with one of each workplace', () => {
    const scenarioWorld = createWorld();
    const plan = planStarterNeighbourhood(scenarioWorld, primaryCity(scenarioWorld))!;
    expect(plan).not.toBeNull();
    const houses = plan.buildings.filter((item) => item.kind === 'house');
    expect(houses.length).toBe(4);
    for (const kind of ['farm', 'granary', 'agora', 'fountain', 'maintenance']) {
      expect(plan.buildings.filter((item) => item.kind === kind).length).toBe(1);
    }
  });
});

describe('building status', () => {
  test('explains what a house is waiting for', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, primaryCity(world), 'house', spot.x, spot.z);
    const house = primaryCity(world).buildings[0];
    expect(buildingStatus(primaryCity(world), house)).toEqual(['Waiting for settlers from the harbour.']);
    house.residents = 8;
    expect(buildingStatus(primaryCity(world), house)[0]).toContain('Needs food');
    house.food = 10;
    expect(buildingStatus(primaryCity(world), house)[0]).toContain('Ready to grow');
  });

  test('tells the player how to fix an agora without a vendor', () => {
    const world = createWorld();
    const spot = spotFor(world, 'agora')!;
    build(world, primaryCity(world), 'agora', spot.x, spot.z);
    const agora = primaryCity(world).buildings[0];
    agora.workers = BUILDINGS.agora.jobs;
    expect(buildingStatus(primaryCity(world), agora)).toEqual(['Add a food vendor to start deliveries.']);
    agora.condition = 20;
    expect(buildingStatus(primaryCity(world), agora).at(-1)).toBe('Neglected; build a maintenance post.');
  });
});

describe('immigration', () => {
  test('settlers walk from the harbour before they count as residents', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, primaryCity(world), 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    let party = null;
    for (let i = 0; i < 20 && !party; i++) {
      advance(world, 0.25);
      party = primaryCity(world).walkers.find((walker) => walker.kind === 'immigrant') ?? null;
      if (party) {
        expect(party.path[0]).toBe(entryTileIndex(world, primaryCity(world)));
        expect(party.targetId).toBe(house.id);
        expect(house.residents).toBe(0);
      }
    }
    expect(party).not.toBeNull();
    advance(world, 30);
    expect(house.residents).toBeGreaterThan(0);
    advance(world, 60);
    expect(house.residents).toBe(8);
    expect(primaryCity(world).walkers.filter((walker) => walker.kind === 'immigrant')).toHaveLength(0);
  });

  test('a house that loses its road stops attracting settlers', () => {
    const world = createWorld();
    const map = mapOf(world);
    const topZ = Math.min(...primaryCity(world).roads.map((road) => Math.floor(road / map.width)));
    const capTile = tileAtOn(map, tileIndexOn(map, map.entry.x, topZ));
    const spot = spotAdjacentTo(world, 'house', capTile)!;
    build(world, primaryCity(world), 'house', spot.x, spot.z);
    advance(world, 1);
    demolish(world, primaryCity(world), capTile.x, capTile.z);
    advance(world, 10);
    expect(primaryCity(world).walkers.filter((walker) => walker.kind === 'immigrant')).toHaveLength(0);
    expect(findByKind(world, 'house').residents).toBe(0);
  });
});

describe('island generation', () => {
  test('generateIsland is deterministic for a given seed', () => {
    const first = generateIsland(7);
    const second = generateIsland(7);
    expect([...first.terrain]).toEqual([...second.terrain]);
    expect([...first.level]).toEqual([...second.level]);
    expect(first.entry).toEqual(second.entry);
  });

  test('every seed from 1 to 8 yields a buildable starter plan', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const seedWorld = createWorld(seed);
      const plan = planStarterNeighbourhood(seedWorld, primaryCity(seedWorld));
      expect(plan).not.toBeNull();
      expect(plan!.buildings.length).toBe(9);
    }
  });
});

const STAIR_SEED = 700_701;

type StairDirection = 'east' | 'west' | 'south' | 'north';

const DOWN_OFFSET: Record<StairDirection, [number, number]> = {
  east: [1, 0],
  west: [-1, 0],
  south: [0, 1],
  north: [0, -1],
};

function setStairTile(map: IslandMap, x: number, z: number, terrain: 'grass' | 'water' | 'cliff', level: number): void {
  const index = tileIndexOn(map, x, z);
  map.terrain[index] = terrain;
  map.level[index] = level;
}

function clearStairArea(map: IslandMap, cx: number, cz: number): void {
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) setStairTile(map, cx + dx, cz + dz, 'water', 0);
}

function orientedStairFixture(direction: StairDirection) {
  const map = islandFor(STAIR_SEED);
  const home = map.islands[map.home];
  const cx = home.x + 12;
  const cz = home.z + 12;
  clearStairArea(map, cx, cz);
  const [ddx, ddz] = DOWN_OFFSET[direction];
  const tile: Tile = { x: cx, z: cz };
  const down: Tile = { x: cx + ddx, z: cz + ddz };
  const up: Tile = { x: cx - ddx, z: cz - ddz };
  const lateralA: Tile = ddx !== 0 ? { x: cx, z: cz - 1 } : { x: cx - 1, z: cz };
  const lateralB: Tile = ddx !== 0 ? { x: cx, z: cz + 1 } : { x: cx + 1, z: cz };
  setStairTile(map, tile.x, tile.z, 'cliff', 1);
  setStairTile(map, down.x, down.z, 'grass', 0);
  setStairTile(map, up.x, up.z, 'grass', 1);
  setStairTile(map, lateralA.x, lateralA.z, 'grass', 1);
  setStairTile(map, lateralB.x, lateralB.z, 'grass', 1);
  return { map, tile, down, up, lateralA, lateralB };
}

describe('carved stairs', () => {
  for (const direction of ['east', 'west', 'south', 'north'] as const) {
    test(`builds a working stair oriented ${direction}, one tile at a time`, () => {
      const { map, down, tile, up } = orientedStairFixture(direction);
      const world = createWorld(STAIR_SEED);
      expect(build(world, primaryCity(world), 'road', down.x, down.z).ok).toBe(true);
      expect(build(world, primaryCity(world), 'road', tile.x, tile.z).ok).toBe(true);
      expect(build(world, primaryCity(world), 'road', up.x, up.z).ok).toBe(true);
      const roads = new Set(primaryCity(world).roads);
      const path = bfsShortest(map, roads, tileIndexOn(map, down.x, down.z), (candidate) => candidate === tileIndexOn(map, up.x, up.z));
      expect(path).toEqual([tileIndexOn(map, down.x, down.z), tileIndexOn(map, tile.x, tile.z), tileIndexOn(map, up.x, up.z)]);
    });
  }

  test('a whole-stroke batch placement produces the same roads as sequential single placement', () => {
    const { down, tile, up } = orientedStairFixture('east');
    const worldSingle = createWorld(STAIR_SEED);
    expect(build(worldSingle, primaryCity(worldSingle), 'road', down.x, down.z).ok).toBe(true);
    expect(build(worldSingle, primaryCity(worldSingle), 'road', tile.x, tile.z).ok).toBe(true);
    expect(build(worldSingle, primaryCity(worldSingle), 'road', up.x, up.z).ok).toBe(true);

    orientedStairFixture('east');
    const worldBatch = createWorld(STAIR_SEED);
    expect(placeRoadPath(worldBatch, primaryCity(worldBatch), [down, tile, up]).ok).toBe(true);

    expect([...primaryCity(worldBatch).roads].sort((a, b) => a - b)).toEqual([...primaryCity(worldSingle).roads].sort((a, b) => a - b));
  });

  test('roadPathPlacement previews the same outcome as placeRoadPath without mutating the world', () => {
    const { down, tile, up } = orientedStairFixture('east');
    const world = createWorld(STAIR_SEED);
    const before = { money: primaryCity(world).money, roads: [...primaryCity(world).roads] };
    const preview = roadPathPlacement(world, primaryCity(world), [down, tile, up]);
    expect(preview.ok).toBe(true);
    expect(primaryCity(world).money).toBe(before.money);
    expect(primaryCity(world).roads).toEqual(before.roads);

    const result = placeRoadPath(world, primaryCity(world), [down, tile, up]);
    expect(result.ok).toBe(true);
    expect(before.money - primaryCity(world).money).toBe(preview.cost);
  });

  test('rejects a second lower neighbour as ambiguous, atomically, whichever tile arrives last', () => {
    const { map, tile, down, lateralA } = orientedStairFixture('east');
    setStairTile(map, lateralA.x, lateralA.z, 'grass', 0);
    setStairTile(map, tile.x, tile.z - 2, 'grass', 1);

    const worldDownFirst = createWorld(STAIR_SEED);
    expect(build(worldDownFirst, primaryCity(worldDownFirst), 'road', down.x, down.z).ok).toBe(true);
    expect(build(worldDownFirst, primaryCity(worldDownFirst), 'road', lateralA.x, lateralA.z).ok).toBe(true);
    const before = primaryCity(worldDownFirst).money;
    const result = placement(worldDownFirst, primaryCity(worldDownFirst), 'road', tile.x, tile.z);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('A stair can only climb in one direction; that cliff edge already has another way down.');
    expect(build(worldDownFirst, primaryCity(worldDownFirst), 'road', tile.x, tile.z).ok).toBe(false);
    expect(primaryCity(worldDownFirst).money).toBe(before);
    expect(primaryCity(worldDownFirst).roads.includes(tileIndexOn(map, tile.x, tile.z))).toBe(false);

    const worldStairFirst = createWorld(STAIR_SEED);
    expect(build(worldStairFirst, primaryCity(worldStairFirst), 'road', down.x, down.z).ok).toBe(true);
    expect(build(worldStairFirst, primaryCity(worldStairFirst), 'road', tile.x, tile.z).ok).toBe(true);
    const secondResult = placement(worldStairFirst, primaryCity(worldStairFirst), 'road', lateralA.x, lateralA.z);
    expect(secondResult.ok).toBe(false);
    expect(secondResult.reason).toBe('A stair can only climb in one direction; that cliff edge already has another way down.');

    const batchWorld = createWorld(STAIR_SEED);
    const batchResult = placeRoadPath(batchWorld, primaryCity(batchWorld), [down, tile, lateralA]);
    expect(batchResult.ok).toBe(false);
    expect(batchResult.reason).toBe('A stair can only climb in one direction; that cliff edge already has another way down.');
  });

  test('rejects a perpendicular road entering a stair from the side, whichever tile arrives last', () => {
    const { down, tile, lateralA } = orientedStairFixture('east');

    const worldStairFirst = createWorld(STAIR_SEED);
    expect(build(worldStairFirst, primaryCity(worldStairFirst), 'road', down.x, down.z).ok).toBe(true);
    expect(build(worldStairFirst, primaryCity(worldStairFirst), 'road', tile.x, tile.z).ok).toBe(true);
    const sideResult = placement(worldStairFirst, primaryCity(worldStairFirst), 'road', lateralA.x, lateralA.z);
    expect(sideResult.ok).toBe(false);
    expect(sideResult.reason).toBe('Stairs can only be entered from the front or back, not the side.');

    orientedStairFixture('east');
    const worldSideFirst = createWorld(STAIR_SEED);
    expect(build(worldSideFirst, primaryCity(worldSideFirst), 'road', down.x, down.z).ok).toBe(true);
    expect(build(worldSideFirst, primaryCity(worldSideFirst), 'road', lateralA.x, lateralA.z).ok).toBe(true);
    const stairResult = placement(worldSideFirst, primaryCity(worldSideFirst), 'road', tile.x, tile.z);
    expect(stairResult.ok).toBe(false);
    expect(stairResult.reason).toBe('Stairs can only be entered from the front or back, not the side.');
  });

  test('rejects a stair whose back landing is water', () => {
    const { map, down, tile, up } = orientedStairFixture('east');
    setStairTile(map, up.x, up.z, 'water', 1);
    const world = createWorld(STAIR_SEED);
    expect(build(world, primaryCity(world), 'road', down.x, down.z).ok).toBe(true);
    const result = placement(world, primaryCity(world), 'road', tile.x, tile.z);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('A stair needs solid, dry ground to land on at the top.');
  });

  test('a valid batch is charged only for its new tiles, and legacy invalid edges elsewhere are untouched', () => {
    const { down, tile, up } = orientedStairFixture('east');
    const world = createWorld(STAIR_SEED);
    expect(build(world, primaryCity(world), 'road', down.x, down.z).ok).toBe(true);
    const before = primaryCity(world).money;
    const result = placeRoadPath(world, primaryCity(world), [down, tile, up]);
    expect(result.ok).toBe(true);
    expect(before - primaryCity(world).money).toBe(ROAD_COST * 2);
  });
});

function minimalBuilding(kind: BuildingKind, x: number, z: number): Building {
  return {
    id: 0, x, z, kind, rotation: 0, tier: 1, residents: 0, food: 0, water: 0, condition: 100, stores: {},
    progress: 0, workers: 0, vendorEnabled: false, vendorInstalled: false, connected: false, serviceTimer: 0, upgradeTimer: 0,
  };
}

describe('building access across a stair', () => {
  test('a door opens onto the landing behind a stair, never onto its side', () => {
    const { map, down, tile, up, lateralA } = orientedStairFixture('east');
    const world = createWorld(STAIR_SEED);
    expect(build(world, primaryCity(world), 'road', down.x, down.z).ok).toBe(true);
    expect(build(world, primaryCity(world), 'road', tile.x, tile.z).ok).toBe(true);
    const roads = new Set(primaryCity(world).roads);
    const stairTileIndex = tileIndexOn(map, tile.x, tile.z);

    const behind = minimalBuilding('fountain', up.x - 1, up.z - 1);
    expect(accessDoors(map, roads, behind)).toContain(stairTileIndex);

    const beside = minimalBuilding('fountain', lateralA.x - 1, lateralA.z - 1);
    expect(accessDoors(map, roads, beside)).not.toContain(stairTileIndex);
  });

  test('exitTile never picks a stair whose landing sits a level above the building, agreeing with accessTiles', () => {
    const { map, down, tile } = orientedStairFixture('east');
    const world = createWorld(STAIR_SEED);
    expect(build(world, primaryCity(world), 'road', down.x, down.z).ok).toBe(true);
    expect(build(world, primaryCity(world), 'road', tile.x, tile.z).ok).toBe(true);
    setStairTile(map, tile.x - 1, tile.z, 'grass', 2);

    const behind = minimalBuilding('fountain', tile.x - 2, tile.z - 1);
    expect(exitTile(world, primaryCity(world), behind)).toBe(-1);
  });
});

function bareWalker(map: IslandMap, from: Tile, to: Tile, progress: number): Walker {
  return {
    id: 1, kind: 'maintenance', homeId: 1, targetId: null,
    path: [tileIndexOn(map, from.x, from.z), tileIndexOn(map, to.x, to.z)],
    step: 0, progress, food: null, cargo: 0, returning: false, overland: [], quarry: null, working: 0,
  };
}

describe('in-flight walkers when a stair changes underfoot', () => {
  test('a walker mid-transition retires when a new lower road turns its current tile into a stair', () => {
    const { map, tile, up, down } = orientedStairFixture('east');
    const world = createWorld(STAIR_SEED);
    expect(build(world, primaryCity(world), 'road', tile.x, tile.z).ok).toBe(true);
    expect(build(world, primaryCity(world), 'road', up.x, up.z).ok).toBe(true);
    primaryCity(world).walkers.push(bareWalker(map, tile, up, 0.4));

    expect(build(world, primaryCity(world), 'road', down.x, down.z).ok).toBe(true);
    expect(primaryCity(world).walkers).toHaveLength(0);
  });

  test('a stationary walker at its final tile retires when a new lower road turns that tile into a stair', () => {
    const { map, tile, down } = orientedStairFixture('east');
    const world = createWorld(STAIR_SEED);
    expect(build(world, primaryCity(world), 'road', tile.x, tile.z).ok).toBe(true);
    const walker = bareWalker(map, tile, tile, 0);
    walker.path = [tileIndexOn(map, tile.x, tile.z)];
    walker.working = 3;
    primaryCity(world).walkers.push(walker);

    expect(build(world, primaryCity(world), 'road', down.x, down.z).ok).toBe(true);
    expect(primaryCity(world).walkers).toHaveLength(0);
  });

  test('a walker mid-transition on the upper half of a stair retires when its foot road is removed', () => {
    const { map, tile, up, down } = orientedStairFixture('east');
    const world = createWorld(STAIR_SEED);
    expect(build(world, primaryCity(world), 'road', down.x, down.z).ok).toBe(true);
    expect(build(world, primaryCity(world), 'road', tile.x, tile.z).ok).toBe(true);
    expect(build(world, primaryCity(world), 'road', up.x, up.z).ok).toBe(true);
    primaryCity(world).walkers.push(bareWalker(map, tile, up, 0.6));

    expect(demolish(world, primaryCity(world), down.x, down.z).ok).toBe(true);
    expect(primaryCity(world).walkers).toHaveLength(0);
  });

  test('a walker on an untouched segment survives an unrelated road mutation', () => {
    const { map, tile, up, down } = orientedStairFixture('east');
    const world = createWorld(STAIR_SEED);
    expect(build(world, primaryCity(world), 'road', down.x, down.z).ok).toBe(true);
    expect(build(world, primaryCity(world), 'road', tile.x, tile.z).ok).toBe(true);
    expect(build(world, primaryCity(world), 'road', up.x, up.z).ok).toBe(true);
    primaryCity(world).walkers.push(bareWalker(map, tile, up, 0.5));

    const spot = spotFor(world, 'maintenance', farCorner(world))!;
    expect(build(world, primaryCity(world), 'maintenance', spot.x, spot.z).ok).toBe(true);
    expect(primaryCity(world).walkers).toHaveLength(1);
  });

  test('dropping a woodcutter never touches wildlife, even if its tile-index quarry collides with an animal id', () => {
    const { map, tile, up, down } = orientedStairFixture('east');
    const world = createWorld(STAIR_SEED);
    expect(build(world, primaryCity(world), 'road', tile.x, tile.z).ok).toBe(true);
    expect(build(world, primaryCity(world), 'road', up.x, up.z).ok).toBe(true);
    const animal = world.wildlife[0];
    animal.cornered = true;
    const walker = bareWalker(map, tile, up, 0.4);
    walker.kind = 'woodcutter';
    walker.quarry = animal.id;
    primaryCity(world).walkers.push(walker);

    expect(build(world, primaryCity(world), 'road', down.x, down.z).ok).toBe(true);
    expect(primaryCity(world).walkers).toHaveLength(0);
    expect(world.wildlife.find((candidate) => candidate.id === animal.id)!.cornered).toBe(true);
  });
});
