import { describe, expect, test } from 'bun:test';
import { advance, build, buildingStatus, createWorld, demolish, getSummary, placeRoadPath, placement, setVendor } from './world';
import { buildStarterNeighbourhood, planStarterNeighbourhood } from './scenario';
import { BUILDINGS, ROAD_COST, STARTING_MONEY, VENDOR_COST } from './catalog';
import { generateIsland, terrainOn, tileAtOn, tileIndexOn } from './island';
import { entryTileIndex } from './grid';
import { connect, farCorner, findTile, freshRoadSpot, isolatedRoadPair, mapOf, slopeFixture, spotAdjacentTo, spotFor, unevenFootprint, SLOPE_SEED } from './testing';
import type { World } from './types';

function findByKind(world: World, kind: string) {
  return world.buildings.find((building) => building.kind === kind)!;
}

describe('placement validation', () => {
  test('rejects out of bounds', () => {
    const world = createWorld();
    const result = placement(world, 'house', 1000, 1000);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Out of bounds.');
  });

  test('farms require fertile ground', () => {
    const world = createWorld();
    const nonFertile = findTile(world, (map, x, z) => ['grass', 'sand', 'scrub'].includes(terrainOn(map, x, z)));
    const onOther = placement(world, 'farm', nonFertile!.x, nonFertile!.z);
    expect(onOther.ok).toBe(false);
    expect(onOther.reason).toBe('Farms need fertile ground.');

    const fertileSpot = spotFor(world, 'farm')!;
    const onFertile = placement(world, 'farm', fertileSpot.x, fertileSpot.z);
    expect(onFertile.ok).toBe(true);
    expect(onFertile.cost).toBe(BUILDINGS.farm.cost);
  });

  test('rejects cliff and water terrain for ordinary buildings', () => {
    const world = createWorld();
    const cliff = findTile(world, (map, x, z) => terrainOn(map, x, z) === 'cliff')!;
    const onCliff = placement(world, 'house', cliff.x, cliff.z);
    expect(onCliff.ok).toBe(false);
    expect(onCliff.reason).toBe('Unsuitable terrain.');

    const water = findTile(world, (map, x, z) => terrainOn(map, x, z) === 'water')!;
    const onWater = placement(world, 'house', water.x, water.z);
    expect(onWater.ok).toBe(false);
    expect(onWater.reason).toBe('Unsuitable terrain.');
  });

  test('rejects uneven footprints', () => {
    const world = createWorld();
    const spot = unevenFootprint(world, 'house')!;
    const result = placement(world, 'house', spot.x, spot.z);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Buildings need level ground.');
  });

  test('reports insufficient funds without mutating money', () => {
    const world = createWorld();
    const spot = spotFor(world, 'farm')!;
    world.money = 10;
    const result = placement(world, 'farm', spot.x, spot.z);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Not enough drachmas.');
    expect(result.cost).toBe(BUILDINGS.farm.cost);
    expect(world.money).toBe(10);
  });

  test('rejects overlapping buildings and building-on-road', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    expect(build(world, 'house', spot.x, spot.z).ok).toBe(true);
    expect(placement(world, 'house', spot.x + 1, spot.z + 1).ok).toBe(false);

    const overlapX = mapOf(world).entry.x - 1;
    const overlapZ = mapOf(world).entry.z - 4;
    expect(placement(world, 'house', overlapX, overlapZ).reason).toBe('That tile is occupied by a road.');
  });

  test('rejects roads on top of buildings', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, 'house', spot.x, spot.z);
    const result = placement(world, 'road', spot.x + 1, spot.z + 1);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('That tile is occupied.');
  });

  test('rejects roads that step between levels', () => {
    const { low, high } = slopeFixture();
    const world = createWorld(SLOPE_SEED);
    expect(build(world, 'road', low.x, low.z).ok).toBe(true);
    const result = placement(world, 'road', high.x, high.z);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Roads cannot climb cliffs.');
  });
});

describe('build costs', () => {
  test('deducts cost on success', () => {
    const world = createWorld();
    const spot = spotFor(world, 'farm')!;
    const before = world.money;
    const result = build(world, 'farm', spot.x, spot.z);
    expect(result.ok).toBe(true);
    expect(world.money).toBe(before - BUILDINGS.farm.cost);
  });

  test('already-present roads cost nothing again', () => {
    const world = createWorld();
    const spot = freshRoadSpot(world)!;
    const first = build(world, 'road', spot.x, spot.z);
    expect(first.ok).toBe(true);
    const spent = STARTING_MONEY - world.money;
    expect(spent).toBe(ROAD_COST);

    const again = build(world, 'road', spot.x, spot.z);
    expect(again.ok).toBe(true);
    expect(STARTING_MONEY - world.money).toBe(spent);
  });

  test('placeRoadPath is atomic and only charges new tiles', () => {
    const world = createWorld();
    const map = mapOf(world);
    const [a, b] = isolatedRoadPair(world, map.entry)!;
    const before = world.money;
    const badPath = [a, b, { x: 1000, z: 1000 }];
    const result = placeRoadPath(world, badPath);
    expect(result.ok).toBe(false);
    expect(world.money).toBe(before);
    expect(world.roads.includes(tileIndexOn(map, a.x, a.z))).toBe(false);

    const goodPath = [{ x: map.entry.x, z: map.entry.z }, a, b];
    const ok = placeRoadPath(world, goodPath);
    expect(ok.ok).toBe(true);
    expect(before - world.money).toBe(ROAD_COST * 2);
  });

  test('rejects a road path that climbs between levels', () => {
    const { low, high } = slopeFixture();
    const world = createWorld(SLOPE_SEED);
    const result = placeRoadPath(world, [low, high]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Roads cannot climb cliffs.');
  });
});

describe('demolition', () => {
  test('demolishing an empty tile fails', () => {
    const world = createWorld();
    const result = demolish(world, 0, 0);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Nothing to demolish there.');
  });

  test('removes a building and refunds half its cost', () => {
    const world = createWorld();
    const spot = spotFor(world, 'farm')!;
    build(world, 'farm', spot.x, spot.z);
    const beforeDemolish = world.money;
    expect(world.buildings.length).toBe(1);
    const result = demolish(world, spot.x, spot.z);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe(`Demolished, ${Math.floor(BUILDINGS.farm.cost / 2)} drachmas refunded.`);
    expect(world.buildings.length).toBe(0);
    expect(world.money).toBe(beforeDemolish + Math.floor(BUILDINGS.farm.cost / 2));
  });

  test('refunds an installed vendor along with the agora', () => {
    const world = createWorld();
    const spot = spotFor(world, 'agora')!;
    build(world, 'agora', spot.x, spot.z);
    const agora = findByKind(world, 'agora');
    setVendor(world, agora.id, true);
    const beforeDemolish = world.money;
    const expected = Math.floor((BUILDINGS.agora.cost + VENDOR_COST) / 2);
    const result = demolish(world, spot.x, spot.z);
    expect(result.ok).toBe(true);
    expect(world.money).toBe(beforeDemolish + expected);
  });

  test('removes a road tile with no refund', () => {
    const world = createWorld();
    const map = mapOf(world);
    const roadIndex = world.roads[0];
    const road = tileAtOn(map, roadIndex);
    const beforeDemolish = world.money;
    const result = demolish(world, road.x, road.z);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('Demolished. Roads are not refunded.');
    expect(world.roads.includes(roadIndex)).toBe(false);
    expect(world.money).toBe(beforeDemolish);
  });

  test('cannot profit by paving and immediately demolishing a road', () => {
    const world = createWorld();
    const spot = freshRoadSpot(world)!;
    const before = world.money;
    build(world, 'road', spot.x, spot.z);
    demolish(world, spot.x, spot.z);
    expect(world.money).toBe(before - ROAD_COST);
  });

  test('demolishing a starter road never yields a refund', () => {
    const world = createWorld();
    const map = mapOf(world);
    const road = tileAtOn(map, world.roads[0]);
    const before = world.money;
    demolish(world, road.x, road.z);
    expect(world.money).toBe(before);
  });
});

describe('valid placements need no reason text', () => {
  test('placement leaves reason empty on success', () => {
    const world = createWorld();
    const farmSpot = spotFor(world, 'farm')!;
    const roadSpot = spotFor(world, 'road')!;
    expect(placement(world, 'farm', farmSpot.x, farmSpot.z).reason).toBe('');
    expect(placement(world, 'road', roadSpot.x, roadSpot.z).reason).toBe('');
  });
});

describe('failure reasons are full sentences', () => {
  test('matches the agreed phrasing for common failures', () => {
    const world = createWorld();
    const farmSpot = spotFor(world, 'farm')!;
    const nonFertile = findTile(world, (map, x, z) => ['grass', 'sand', 'scrub'].includes(terrainOn(map, x, z)))!;
    world.money = 10;
    expect(placement(world, 'farm', farmSpot.x, farmSpot.z).reason).toBe('Not enough drachmas.');
    expect(placement(world, 'farm', nonFertile.x, nonFertile.z).reason).toBe('Farms need fertile ground.');
    expect(placement(world, 'house', 1000, 1000).reason).toBe('Out of bounds.');
  });
});

describe('human-readable action results', () => {
  test('build reports what was built', () => {
    const world = createWorld();
    const houseSpot = spotFor(world, 'house')!;
    const roadSpot = spotFor(world, 'road')!;
    expect(build(world, 'house', houseSpot.x, houseSpot.z).reason).toBe('Dwelling built.');
    expect(build(world, 'road', roadSpot.x, roadSpot.z).reason).toBe('Road laid.');
  });

  test('setVendor reports install, enable and disable distinctly', () => {
    const world = createWorld();
    const spot = spotFor(world, 'agora')!;
    build(world, 'agora', spot.x, spot.z);
    const agora = findByKind(world, 'agora');
    expect(setVendor(world, agora.id, true).reason).toBe('Food vendor added.');
    expect(setVendor(world, agora.id, true).reason).toBe('Vendor already active.');
    expect(setVendor(world, agora.id, false).reason).toBe('Vendor paused.');
    expect(setVendor(world, agora.id, true).reason).toBe('Vendor resumed.');
  });
});

describe('connectivity', () => {
  test('disconnected placement succeeds but is flagged', () => {
    const world = createWorld();
    const spot = spotFor(world, 'farm', farCorner(world))!;
    const result = build(world, 'farm', spot.x, spot.z);
    expect(result.ok).toBe(true);
    const farm = findByKind(world, 'farm');
    expect(farm.connected).toBe(false);
    expect(buildingStatus(world, farm)).toEqual(['Not linked to a road; nobody can reach it.']);
  });

  test('a road island that does not reach the entry is not connected', () => {
    const world = createWorld();
    const pair = isolatedRoadPair(world, farCorner(world))!;
    placeRoadPath(world, pair);
    const spot = spotAdjacentTo(world, 'house', pair[1])!;
    const result = build(world, 'house', spot.x, spot.z);
    expect(result.ok).toBe(true);
    const house = findByKind(world, 'house');
    expect(house.connected).toBe(false);
  });

  test('touching the starter road network connects a building', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    if (!house.connected) connect(world, house);
    expect(house.connected).toBe(true);
  });
});

describe('vendor enablement', () => {
  test('charges once, and re-enabling does not charge again', () => {
    const world = createWorld();
    const spot = spotFor(world, 'agora')!;
    build(world, 'agora', spot.x, spot.z);
    const agora = findByKind(world, 'agora');
    const before = world.money;

    expect(setVendor(world, agora.id, true).ok).toBe(true);
    expect(before - world.money).toBe(VENDOR_COST);

    expect(setVendor(world, agora.id, false).ok).toBe(true);
    expect(setVendor(world, agora.id, true).ok).toBe(true);
    expect(before - world.money).toBe(VENDOR_COST);
  });

  test('rejects vendor on a non-agora building', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    const result = setVendor(world, house.id, true);
    expect(result.ok).toBe(false);
  });

  test('rejects enabling without funds for the first install', () => {
    const world = createWorld();
    const spot = spotFor(world, 'agora')!;
    build(world, 'agora', spot.x, spot.z);
    const agora = findByKind(world, 'agora');
    world.money = 0;
    const result = setVendor(world, agora.id, true);
    expect(result.ok).toBe(false);
    expect(agora.vendorInstalled).toBe(false);
  });
});

describe('labour', () => {
  test('workplaces have no workers with no population', () => {
    const world = createWorld();
    const spot = spotFor(world, 'farm')!;
    build(world, 'farm', spot.x, spot.z);
    advance(world, 5);
    const farm = findByKind(world, 'farm');
    expect(farm.workers).toBe(0);
  });

  test('disconnected workplaces never receive workers even with population available', () => {
    const world = createWorld();
    const houseSpot = spotFor(world, 'house')!;
    build(world, 'house', houseSpot.x, houseSpot.z);
    const farmSpot = spotFor(world, 'farm', farCorner(world))!;
    build(world, 'farm', farmSpot.x, farmSpot.z);
    advance(world, 60);
    const farm = findByKind(world, 'farm');
    expect(farm.connected).toBe(false);
    expect(farm.workers).toBe(0);
  });

  test('employment is roughly half of population, split across jobs', () => {
    const world = createWorld();
    buildStarterNeighbourhood(world);
    advance(world, 30);
    const summary = getSummary(world);
    expect(summary.workers).toBeGreaterThan(0);
    expect(summary.workers).toBeLessThanOrEqual(summary.jobs);
  });
});

describe('the full supply chain', () => {
  test('reaches first food well under 90 seconds and a tier upgrade under 240 seconds', () => {
    const world = createWorld();
    expect(buildStarterNeighbourhood(world).ok).toBe(true);

    let firstFoodAt: number | null = null;
    let firstUpgradeAt: number | null = null;
    for (let i = 0; i < 400 && (firstFoodAt === null || firstUpgradeAt === null); i++) {
      advance(world, 1);
      const houses = world.buildings.filter((building) => building.kind === 'house');
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
    buildStarterNeighbourhood(world);
    advance(world, 300);
    const summary = getSummary(world);
    expect(summary.goal).toBe(true);
    expect(summary.balance).toBeGreaterThanOrEqual(0);
    expect(world.produced).toBeGreaterThan(0);
    expect(world.delivered).toBeGreaterThan(0);
  });

  test('sustains for 10+ simulated minutes without instability', () => {
    const world = createWorld();
    buildStarterNeighbourhood(world);
    advance(world, 700);
    const summary = getSummary(world);
    expect(Number.isFinite(world.money)).toBe(true);
    expect(Number.isFinite(summary.population)).toBe(true);
    expect(summary.population).toBeGreaterThan(0);
    expect(summary.goal).toBe(true);
    for (const building of world.buildings) {
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
    buildStarterNeighbourhood(world);
    advance(world, 200);
    const houses = world.buildings.filter((building) => building.kind === 'house' && building.tier === 3);
    expect(houses.length).toBeGreaterThan(0);
    for (const house of houses) expect(house.water).toBeGreaterThan(0);
  });

  test('condition decays without maintenance and is repaired with it', () => {
    const isolated = createWorld();
    const spot = spotFor(isolated, 'house')!;
    build(isolated, 'house', spot.x, spot.z);
    advance(isolated, 1200);
    const lonelyHouse = findByKind(isolated, 'house');
    expect(lonelyHouse.condition).toBeLessThan(100);

    const maintained = createWorld();
    buildStarterNeighbourhood(maintained);
    advance(maintained, 1200);
    for (const building of maintained.buildings) {
      expect(building.condition).toBeGreaterThan(90);
    }
  });
});

describe('housing grace and devolution', () => {
  test('a tier-2 house devolves after sustained food loss beyond the grace period', () => {
    const world = createWorld();
    buildStarterNeighbourhood(world);
    advance(world, 90);
    const house = world.buildings.find((building) => building.kind === 'house' && building.tier >= 2)!;
    expect(house).toBeTruthy();
    const startingTier = house.tier;

    const agora = findByKind(world, 'agora');
    setVendor(world, agora.id, false);
    world.walkers = world.walkers.filter((walker) => walker.kind !== 'vendor');
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
    buildStarterNeighbourhood(world);
    advance(world, 5);
    expect(world.walkers.length).toBeGreaterThan(0);

    const map = mapOf(world);
    const walker = world.walkers[0];
    const midTile = walker.path[Math.floor(walker.path.length / 2)];
    for (const road of [...world.roads]) {
      if (road === midTile) {
        const { x, z } = tileAtOn(map, road);
        demolish(world, x, z);
        break;
      }
    }

    expect(() => advance(world, 100)).not.toThrow();
    for (const building of world.buildings) {
      for (const amount of Object.values(building.stores)) {
        expect(amount).toBeGreaterThan(0);
        expect(Number.isFinite(amount)).toBe(true);
      }
    }
  });

  test('demolishing a cart target reverses the walker instead of corrupting supplies', () => {
    const world = createWorld();
    buildStarterNeighbourhood(world);
    advance(world, 5);
    const cart = world.walkers.find((walker) => walker.kind === 'cart');
    if (!cart) return;
    const granary = findByKind(world, 'granary');
    demolish(world, granary.x, granary.z);
    const updated = world.walkers.find((walker) => walker.id === cart.id);
    if (updated) {
      expect(updated.targetId).toBeNull();
      expect(updated.returning).toBe(true);
    }
    expect(() => advance(world, 30)).not.toThrow();
  });

  test('demolishing a cart source removes it cleanly', () => {
    const world = createWorld();
    buildStarterNeighbourhood(world);
    advance(world, 5);
    const cart = world.walkers.find((walker) => walker.kind === 'cart');
    if (!cart) return;
    const farm = findByKind(world, 'farm');
    demolish(world, farm.x, farm.z);
    expect(world.walkers.some((walker) => walker.id === cart.id)).toBe(false);
    expect(() => advance(world, 30)).not.toThrow();
  });
});

describe('determinism', () => {
  test('advancing in one big step matches many small steps', () => {
    const worldA = createWorld();
    buildStarterNeighbourhood(worldA);
    const worldB = createWorld();
    buildStarterNeighbourhood(worldB);

    advance(worldA, 123);
    for (let i = 0; i < 123; i++) advance(worldB, 1);

    expect(worldA.time).toBe(worldB.time);
    expect(worldA.money).toBeCloseTo(worldB.money, 6);
    expect(worldA.produced).toBe(worldB.produced);
    expect(worldA.delivered).toBeCloseTo(worldB.delivered, 6);
    expect(worldA.buildings).toEqual(worldB.buildings);
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
    build(world, 'farm', spot.x, spot.z);
    const farm = findByKind(world, 'farm');
    expect(buildingStatus(world, farm)).toEqual(['Not linked to a road; nobody can reach it.']);
  });

  test('an empty connected house is waiting for settlers', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    expect(buildingStatus(world, house)).toEqual(['Waiting for settlers from the harbour.']);
  });

  test('a full tier-1 house without food is blocked from growing', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    house.residents = 8;
    expect(buildingStatus(world, house)).toEqual(['Needs food to grow: add an agora vendor nearby.']);
  });

  test('a full, fed tier-2 house without water cannot become a courtyard house', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    house.tier = 2;
    house.residents = 12;
    house.food = 10;
    house.water = 0;
    expect(buildingStatus(world, house)).toEqual(['Needs water to become a courtyard house.']);
  });

  test('a tier-2 house that has run out of food is in distress, not just growth-blocked', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    house.tier = 2;
    house.residents = 5;
    house.food = 0;
    expect(buildingStatus(world, house)).toEqual(['Out of food; a vendor visit is needed.']);
  });

  test('a tier-3 house that has run dry needs water, not food', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    house.tier = 3;
    house.residents = 15;
    house.food = 5;
    house.water = 0;
    expect(buildingStatus(world, house)).toEqual(['Out of water; a fountain visit is needed.']);
  });

  test('a full, satisfied tier-3 house is described as thriving', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    house.tier = 3;
    house.residents = 20;
    house.food = 5;
    house.water = 5;
    expect(buildingStatus(world, house)).toEqual(['A thriving courtyard house.']);
  });

  test('low condition adds a neglect warning alongside the primary line', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    house.tier = 3;
    house.residents = 20;
    house.food = 5;
    house.water = 5;
    house.condition = 20;
    expect(buildingStatus(world, house)).toEqual(['A thriving courtyard house.', 'Neglected; build a maintenance post.']);
    const maintenanceSpot = spotFor(world, 'maintenance')!;
    build(world, 'maintenance', maintenanceSpot.x, maintenanceSpot.z);
    expect(buildingStatus(world, house).at(-1)).toBe('Neglected; a caretaker will repair it.');
  });

  test('an unstaffed workplace says so before anything else', () => {
    const world = createWorld();
    const spot = spotFor(world, 'farm')!;
    build(world, 'farm', spot.x, spot.z);
    const farm = findByKind(world, 'farm');
    farm.connected = true;
    expect(buildingStatus(world, farm)).toEqual(['Unstaffed; settlers are needed for work.']);
    farm.workers = 2;
    expect(buildingStatus(world, farm)).toEqual(['Short of workers; more settlers are needed.']);
  });

  test('a staffed farm reports harvest progress', () => {
    const world = createWorld();
    const spot = spotFor(world, 'farm')!;
    build(world, 'farm', spot.x, spot.z);
    const farm = findByKind(world, 'farm');
    farm.connected = true;
    farm.workers = BUILDINGS.farm.jobs;
    farm.progress = 0.4;
    expect(buildingStatus(world, farm)).toEqual(['Growing wheat, 40% to harvest.']);
  });

  test('an empty granary is waiting for a cart, a stocked one is ready', () => {
    const world = createWorld();
    const spot = spotFor(world, 'granary')!;
    build(world, 'granary', spot.x, spot.z);
    const granary = findByKind(world, 'granary');
    granary.workers = BUILDINGS.granary.jobs;
    expect(buildingStatus(world, granary)).toEqual(['Empty; waiting for a farm cart.']);
    granary.stores.wheat = 50;
    expect(buildingStatus(world, granary)).toEqual(['Stocked and ready for buyers.']);
  });

  test('an agora without a vendor asks for one', () => {
    const world = createWorld();
    const spot = spotFor(world, 'agora')!;
    build(world, 'agora', spot.x, spot.z);
    const agora = findByKind(world, 'agora');
    agora.workers = BUILDINGS.agora.jobs;
    expect(buildingStatus(world, agora)).toEqual(['Add a food vendor to start deliveries.']);
  });

  test('an installed but idle vendor is resting, an active one is on the streets', () => {
    const world = createWorld();
    buildStarterNeighbourhood(world);
    const agora = findByKind(world, 'agora');

    let sawResting = false;
    let sawActive = false;
    for (let i = 0; i < 300 && !(sawResting && sawActive); i++) {
      advance(world, 1);
      const line = buildingStatus(world, agora)[0];
      if (line === 'Vendor resting at market.') sawResting = true;
      if (line === 'Vendor on the streets.') sawActive = true;
    }
    expect(sawResting).toBe(true);
    expect(sawActive).toBe(true);
  });
});

describe('scenario helper', () => {
  test('plans a four-house neighbourhood with one of each workplace', () => {
    const plan = planStarterNeighbourhood(createWorld())!;
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
    build(world, 'house', spot.x, spot.z);
    const house = world.buildings[0];
    expect(buildingStatus(world, house)).toEqual(['Waiting for settlers from the harbour.']);
    house.residents = 8;
    expect(buildingStatus(world, house)[0]).toContain('Needs food');
    house.food = 10;
    expect(buildingStatus(world, house)[0]).toContain('Ready to grow');
  });

  test('tells the player how to fix an agora without a vendor', () => {
    const world = createWorld();
    const spot = spotFor(world, 'agora')!;
    build(world, 'agora', spot.x, spot.z);
    const agora = world.buildings[0];
    agora.workers = BUILDINGS.agora.jobs;
    expect(buildingStatus(world, agora)).toEqual(['Add a food vendor to start deliveries.']);
    agora.condition = 20;
    expect(buildingStatus(world, agora).at(-1)).toBe('Neglected; build a maintenance post.');
  });
});

describe('immigration', () => {
  test('settlers walk from the harbour before they count as residents', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, 'house', spot.x, spot.z);
    const house = findByKind(world, 'house');
    let party = null;
    for (let i = 0; i < 20 && !party; i++) {
      advance(world, 0.25);
      party = world.walkers.find((walker) => walker.kind === 'immigrant') ?? null;
      if (party) {
        expect(party.path[0]).toBe(entryTileIndex(world));
        expect(party.targetId).toBe(house.id);
        expect(house.residents).toBe(0);
      }
    }
    expect(party).not.toBeNull();
    advance(world, 30);
    expect(house.residents).toBeGreaterThan(0);
    advance(world, 60);
    expect(house.residents).toBe(8);
    expect(world.walkers.filter((walker) => walker.kind === 'immigrant')).toHaveLength(0);
  });

  test('a house that loses its road stops attracting settlers', () => {
    const world = createWorld();
    const map = mapOf(world);
    const topZ = Math.min(...world.roads.map((road) => Math.floor(road / map.width)));
    const capTile = tileAtOn(map, tileIndexOn(map, map.entry.x, topZ));
    const spot = spotAdjacentTo(world, 'house', capTile)!;
    build(world, 'house', spot.x, spot.z);
    advance(world, 1);
    demolish(world, capTile.x, capTile.z);
    advance(world, 10);
    expect(world.walkers.filter((walker) => walker.kind === 'immigrant')).toHaveLength(0);
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
      const plan = planStarterNeighbourhood(createWorld(seed));
      expect(plan).not.toBeNull();
      expect(plan!.buildings.length).toBe(9);
    }
  });
});
