import { describe, expect, test } from 'bun:test';
import { advance, build, buildingStatus, demolish, getSummary, placeRoadPath, placement, setVendor } from './world';
import { buildStarterNeighbourhood, STARTER_NEIGHBOURHOOD } from './scenario';
import { BUILDINGS, ROAD_COST, STARTING_MONEY, VENDOR_COST } from './catalog';
import { createWorld } from './world';
import { terrainAt, tileIndex } from './island';

function findByKind(world: ReturnType<typeof createWorld>, kind: string) {
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
    const onGrass = placement(world, 'farm', 12, 17);
    expect(onGrass.ok).toBe(false);
    expect(onGrass.reason).toBe('Farms need fertile ground.');

    const onFertile = placement(world, 'farm', 26, 11);
    expect(onFertile.ok).toBe(true);
    expect(onFertile.cost).toBe(BUILDINGS.farm.cost);
  });

  test('rejects hill and water terrain for ordinary buildings', () => {
    const world = createWorld();
    expect(terrainAt(10, 9)).toBe('hill');
    const onHill = placement(world, 'house', 10, 9);
    expect(onHill.ok).toBe(false);

    expect(terrainAt(37, 20)).toBe('water');
    const onWater = placement(world, 'house', 37, 20);
    expect(onWater.ok).toBe(false);
  });

  test('reports insufficient funds without mutating money', () => {
    const world = createWorld();
    world.money = 10;
    const result = placement(world, 'farm', 26, 11);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Not enough drachmas.');
    expect(result.cost).toBe(BUILDINGS.farm.cost);
    expect(world.money).toBe(10);
  });

  test('rejects overlapping buildings and building-on-road', () => {
    const world = createWorld();
    expect(build(world, 'house', 10, 17).ok).toBe(true);
    expect(placement(world, 'house', 11, 18).ok).toBe(false);
    expect(placement(world, 'house', 21, 20).reason).toBe('That tile is occupied by a road.');
  });

  test('rejects roads on top of buildings', () => {
    const world = createWorld();
    build(world, 'house', 10, 17);
    const result = placement(world, 'road', 11, 18);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('That tile is occupied.');
  });
});

describe('build costs', () => {
  test('deducts cost on success', () => {
    const world = createWorld();
    const before = world.money;
    const result = build(world, 'farm', 26, 11);
    expect(result.ok).toBe(true);
    expect(world.money).toBe(before - BUILDINGS.farm.cost);
  });

  test('already-present roads cost nothing again', () => {
    const world = createWorld();
    const first = build(world, 'road', 15, 21);
    expect(first.ok).toBe(true);
    const spent = STARTING_MONEY - world.money;
    expect(spent).toBe(ROAD_COST);

    const again = build(world, 'road', 15, 21);
    expect(again.ok).toBe(true);
    expect(STARTING_MONEY - world.money).toBe(spent);
  });

  test('placeRoadPath is atomic and only charges new tiles', () => {
    const world = createWorld();
    const before = world.money;
    const path = [
      { x: 15, z: 21 },
      { x: 16, z: 21 },
      { x: 1000, z: 1000 },
    ];
    const result = placeRoadPath(world, path);
    expect(result.ok).toBe(false);
    expect(world.money).toBe(before);
    expect(world.roads.includes(tileIndex(15, 21))).toBe(false);

    const goodPath = [
      { x: 21, z: 20 },
      { x: 15, z: 21 },
      { x: 16, z: 21 },
    ];
    const ok = placeRoadPath(world, goodPath);
    expect(ok.ok).toBe(true);
    expect(before - world.money).toBe(ROAD_COST * 2);
  });
});

describe('demolition', () => {
  test('demolishing an empty tile fails', () => {
    const world = createWorld();
    const result = demolish(world, 5, 5);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Nothing to demolish there.');
  });

  test('removes a building and refunds half its cost', () => {
    const world = createWorld();
    build(world, 'farm', 26, 11);
    const beforeDemolish = world.money;
    expect(world.buildings.length).toBe(1);
    const result = demolish(world, 27, 12);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe(`Demolished, ${Math.floor(BUILDINGS.farm.cost / 2)} drachmas refunded.`);
    expect(world.buildings.length).toBe(0);
    expect(world.money).toBe(beforeDemolish + Math.floor(BUILDINGS.farm.cost / 2));
  });

  test('refunds an installed vendor along with the agora', () => {
    const world = createWorld();
    build(world, 'agora', 13, 21);
    const agora = findByKind(world, 'agora');
    setVendor(world, agora.id, true);
    const beforeDemolish = world.money;
    const expected = Math.floor((BUILDINGS.agora.cost + VENDOR_COST) / 2);
    const result = demolish(world, 14, 22);
    expect(result.ok).toBe(true);
    expect(world.money).toBe(beforeDemolish + expected);
  });

  test('removes a road tile with no refund', () => {
    const world = createWorld();
    expect(world.roads.includes(tileIndex(21, 20))).toBe(true);
    const beforeDemolish = world.money;
    const result = demolish(world, 21, 20);
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('Demolished. Roads are not refunded.');
    expect(world.roads.includes(tileIndex(21, 20))).toBe(false);
    expect(world.money).toBe(beforeDemolish);
  });

  test('cannot profit by paving and immediately demolishing a road', () => {
    const world = createWorld();
    const before = world.money;
    build(world, 'road', 15, 21);
    demolish(world, 15, 21);
    expect(world.money).toBe(before - ROAD_COST);
  });

  test('demolishing a starter road never yields a refund', () => {
    const world = createWorld();
    const before = world.money;
    demolish(world, 21, 20);
    expect(world.money).toBe(before);
  });
});

describe('valid placements need no reason text', () => {
  test('placement leaves reason empty on success', () => {
    const world = createWorld();
    expect(placement(world, 'farm', 26, 11).reason).toBe('');
    expect(placement(world, 'road', 15, 21).reason).toBe('');
  });
});

describe('failure reasons are full sentences', () => {
  test('matches the agreed phrasing for common failures', () => {
    const world = createWorld();
    world.money = 10;
    expect(placement(world, 'farm', 26, 11).reason).toBe('Not enough drachmas.');
    expect(placement(world, 'farm', 12, 17).reason).toBe('Farms need fertile ground.');
    expect(placement(world, 'house', 1000, 1000).reason).toBe('Out of bounds.');
  });
});

describe('human-readable action results', () => {
  test('build reports what was built', () => {
    const world = createWorld();
    expect(build(world, 'house', 10, 17).reason).toBe('Dwelling built.');
    expect(build(world, 'road', 15, 21).reason).toBe('Road laid.');
  });

  test('setVendor reports install, enable and disable distinctly', () => {
    const world = createWorld();
    build(world, 'agora', 13, 21);
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
    const result = build(world, 'farm', 30, 9);
    expect(result.ok).toBe(true);
    const farm = findByKind(world, 'farm');
    expect(farm.connected).toBe(false);
    expect(buildingStatus(world, farm)[0]).toContain('Not connected');
  });

  test('a road island that does not reach the entry is not connected', () => {
    const world = createWorld();
    placeRoadPath(world, [{ x: 30, z: 9 }, { x: 31, z: 9 }]);
    const result = build(world, 'farm', 31, 10);
    expect(result.ok).toBe(true);
    const farm = findByKind(world, 'farm');
    expect(farm.connected).toBe(false);
  });

  test('touching the starter road network connects a building', () => {
    const world = createWorld();
    build(world, 'house', 10, 17);
    const house = findByKind(world, 'house');
    expect(house.connected).toBe(true);
  });
});

describe('vendor enablement', () => {
  test('charges once, and re-enabling does not charge again', () => {
    const world = createWorld();
    build(world, 'agora', 13, 21);
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
    build(world, 'house', 10, 17);
    const house = findByKind(world, 'house');
    const result = setVendor(world, house.id, true);
    expect(result.ok).toBe(false);
  });

  test('rejects enabling without funds for the first install', () => {
    const world = createWorld();
    build(world, 'agora', 13, 21);
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
    build(world, 'farm', 26, 11);
    advance(world, 5);
    const farm = findByKind(world, 'farm');
    expect(farm.workers).toBe(0);
  });

  test('disconnected workplaces never receive workers even with population available', () => {
    const world = createWorld();
    build(world, 'house', 10, 17);
    build(world, 'farm', 30, 9);
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
    build(isolated, 'house', 10, 17);
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

    const walker = world.walkers[0];
    const midTile = walker.path[Math.floor(walker.path.length / 2)];
    for (const road of [...world.roads]) {
      if (road === midTile) {
        const { x, z } = { x: road % 40, z: Math.floor(road / 40) };
        demolish(world, x, z);
        break;
      }
    }

    expect(() => advance(world, 100)).not.toThrow();
    for (const building of world.buildings) {
      expect(building.stock).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(building.stock)).toBe(true);
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

describe('scenario helper', () => {
  test('lists a four-house neighbourhood with one of each workplace', () => {
    const houses = STARTER_NEIGHBOURHOOD.filter((item) => item.tool === 'house');
    expect(houses.length).toBe(4);
    for (const kind of ['farm', 'granary', 'agora', 'fountain', 'maintenance']) {
      expect(STARTER_NEIGHBOURHOOD.filter((item) => item.tool === kind).length).toBe(1);
    }
  });
});
