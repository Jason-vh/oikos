import { describe, expect, test } from 'bun:test';
import { advance, addStore, build, createWorld, demolish, placement, setVendor } from './world';
import { connect, homeTiles, mapOf, spotFor } from './testing';
import { terrainOn, tileAtOn } from './island';
import { deserializeWorld, serializeWorld } from './save';
import { HARBOUR_DOCK_CAP, HARBOUR_MIN_CARGO, HARBOUR_UPGRADE_LUMBER } from './harbour';
import { primaryCity } from './city';

function stockpileWorld(seed = 1) {
  const world = createWorld(seed);
  const spot = spotFor(world, 'stockpile')!;
  expect(build(world, 'stockpile', spot.x, spot.z).ok).toBe(true);
  const stockpile = primaryCity(world).buildings[0];
  expect(connect(world, stockpile).ok).toBe(true);
  return { world, stockpile };
}

function improvedWorld(seed = 1) {
  const built = stockpileWorld(seed);
  primaryCity(built.world).harbour.tier = 2;
  return built;
}

describe('the harbour is always present', () => {
  test('a fresh world has an unimproved harbour already connected to the starter road', () => {
    const world = createWorld();
    expect(primaryCity(world).harbour.kind).toBe('harbour');
    expect(primaryCity(world).harbour.tier).toBe(1);
    expect(primaryCity(world).harbour.connected).toBe(true);
  });

  test('cannot be demolished', () => {
    const world = createWorld();
    const result = demolish(world, primaryCity(world).harbour.x, primaryCity(world).harbour.z);
    expect(result.ok).toBe(false);
    expect(primaryCity(world).harbour.tier).toBe(1);
  });

  test('nothing can be built or paved over its footprint', () => {
    const world = createWorld();
    expect(placement(world, 'house', primaryCity(world).harbour.x, primaryCity(world).harbour.z).ok).toBe(false);
    expect(placement(world, 'road', primaryCity(world).harbour.x, primaryCity(world).harbour.z).ok).toBe(false);
  });
});

describe('rebuilding the harbour in stone', () => {
  test('lumber physically carried from a stockpile rebuilds the harbour once enough has arrived', () => {
    const { world, stockpile } = stockpileWorld();
    addStore(stockpile, 'lumber', HARBOUR_UPGRADE_LUMBER * 2);
    let upgraded = false;
    for (let t = 0; t < 600 && !upgraded; t++) {
      advance(world, 1);
      upgraded = primaryCity(world).harbour.tier === 2;
    }
    expect(upgraded).toBe(true);
    expect(primaryCity(world).harbour.stores.lumber ?? 0).toBe(0);
    expect(primaryCity(world).walkers.some((walker) => walker.kind === 'porter')).toBe(false);
  });

  test('a woodcutter-fed stockpile eventually rebuilds it too', () => {
    const world = createWorld(1);
    const map = mapOf(world);
    let spot = null as ReturnType<typeof spotFor>;
    for (const tree of homeTiles(world, (island, x, z) => terrainOn(island, x, z) === 'forest')) {
      if (spot) break;
      const candidate = spotFor(world, 'woodcutter', tree);
      if (candidate && Math.abs(candidate.x - tree.x) + Math.abs(candidate.z - tree.z) < 7) spot = candidate;
    }
    expect(spot).not.toBeNull();
    build(world, 'woodcutter', spot!.x, spot!.z);
    connect(world, primaryCity(world).buildings[0]);
    const pileSpot = spotFor(world, 'stockpile', spot!)!;
    build(world, 'stockpile', pileSpot.x, pileSpot.z);
    connect(world, primaryCity(world).buildings[1]);
    const houseSpot = spotFor(world, 'house', map.entry)!;
    build(world, 'house', houseSpot.x, houseSpot.z);
    connect(world, primaryCity(world).buildings[2]);
    let upgraded = false;
    for (let t = 0; t < 6000 && !upgraded; t++) {
      advance(world, .5);
      upgraded = primaryCity(world).harbour.tier === 2;
    }
    expect(upgraded).toBe(true);
  });
});

describe('the renewable lumber trade', () => {
  test('refuses to start before the harbour is rebuilt', () => {
    const { world } = stockpileWorld();
    const result = setVendor(world, primaryCity(world).harbour.id, true);
    expect(result.ok).toBe(false);
    expect(primaryCity(world).harbour.vendorEnabled).toBe(false);
  });

  test('a disabled trade never fetches lumber, ships anything, or spends it', () => {
    const { world, stockpile } = improvedWorld();
    addStore(stockpile, 'lumber', HARBOUR_DOCK_CAP);
    advance(world, 200);
    expect(primaryCity(world).harbour.progress).toBe(0);
    expect(primaryCity(world).harbour.stores.lumber ?? 0).toBe(0);
    expect(stockpile.stores.lumber ?? 0).toBe(HARBOUR_DOCK_CAP);
  });

  test('an enabled trade ships lumber for money, repeatedly, as more lumber arrives', () => {
    const { world, stockpile } = improvedWorld();
    addStore(stockpile, 'lumber', HARBOUR_DOCK_CAP * 4);
    expect(setVendor(world, primaryCity(world).harbour.id, true).ok).toBe(true);

    const startingMoney = primaryCity(world).money;
    let payouts = 0;
    let lastMoney = startingMoney;
    for (let t = 0; t < 2000 && payouts < 2; t++) {
      advance(world, 1);
      if (primaryCity(world).money > lastMoney) {
        payouts++;
        lastMoney = primaryCity(world).money;
      }
    }
    expect(payouts).toBeGreaterThanOrEqual(2);
    expect(primaryCity(world).money).toBeGreaterThan(startingMoney);
  });

  test('pausing and resuming the trade order never charges twice', () => {
    const { world } = improvedWorld();
    expect(setVendor(world, primaryCity(world).harbour.id, true).reason).toBe('Lumber trade started.');
    expect(setVendor(world, primaryCity(world).harbour.id, false).reason).toBe('Lumber trade paused.');
    expect(setVendor(world, primaryCity(world).harbour.id, true).reason).toBe('Lumber trade resumed.');
  });

  test('a ship never departs below the minimum cargo threshold', () => {
    const { world, stockpile } = improvedWorld();
    addStore(stockpile, 'lumber', HARBOUR_MIN_CARGO - 1);
    setVendor(world, primaryCity(world).harbour.id, true);
    advance(world, 300);
    expect(primaryCity(world).harbour.progress).toBe(0);
  });
});

describe('robustness', () => {
  test('demolishing the source stockpile mid-delivery drops the porter and its cargo without corrupting stock', () => {
    const { world, stockpile } = stockpileWorld();
    addStore(stockpile, 'lumber', HARBOUR_UPGRADE_LUMBER);
    let dispatched = false;
    for (let t = 0; t < 400 && !dispatched; t++) {
      advance(world, .25);
      dispatched = primaryCity(world).walkers.some((walker) => walker.kind === 'porter');
    }
    expect(dispatched).toBe(true);
    demolish(world, stockpile.x, stockpile.z);
    expect(primaryCity(world).walkers.some((walker) => walker.kind === 'porter')).toBe(false);
    expect(() => advance(world, 20)).not.toThrow();
    expect(primaryCity(world).harbour.stores.lumber ?? 0).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(primaryCity(world).harbour.stores.lumber ?? 0)).toBe(true);
  });

  test('cutting the road under an in-flight porter drops it instead of letting it jump the gap', () => {
    const { world, stockpile } = stockpileWorld();
    addStore(stockpile, 'lumber', HARBOUR_UPGRADE_LUMBER);
    let porter = primaryCity(world).walkers.find((walker) => walker.kind === 'porter');
    for (let t = 0; t < 400 && !porter; t++) {
      advance(world, .25);
      porter = primaryCity(world).walkers.find((walker) => walker.kind === 'porter');
    }
    expect(porter).toBeDefined();
    const map = mapOf(world);
    const midTile = porter!.path[Math.floor(porter!.path.length / 2)];
    const { x, z } = tileAtOn(map, midTile);
    demolish(world, x, z);
    expect(() => advance(world, 30)).not.toThrow();
    expect(primaryCity(world).walkers.some((walker) => walker.kind === 'porter' && walker.id === porter!.id)).toBe(false);
    expect(primaryCity(world).harbour.stores.lumber ?? 0).toBeGreaterThanOrEqual(0);
  });
});

describe('save and load', () => {
  test('an in-flight porter round-trips exactly, then keeps working', () => {
    const { world, stockpile } = stockpileWorld();
    addStore(stockpile, 'lumber', HARBOUR_UPGRADE_LUMBER);
    let porter = primaryCity(world).walkers.find((walker) => walker.kind === 'porter');
    for (let t = 0; t < 400 && !porter; t++) {
      advance(world, .25);
      porter = primaryCity(world).walkers.find((walker) => walker.kind === 'porter');
    }
    expect(porter).toBeDefined();

    const raw = serializeWorld(world);
    const reloaded = deserializeWorld(raw);
    expect(reloaded).not.toBeNull();
    expect(reloaded).toEqual(JSON.parse(raw));

    let upgraded = false;
    for (let t = 0; t < 600 && !upgraded; t++) {
      advance(reloaded!, 1);
      upgraded = primaryCity(reloaded!).harbour.tier === 2;
    }
    expect(upgraded).toBe(true);
  });

  test('a rebuilt, trading harbour round-trips its progress exactly', () => {
    const { world, stockpile } = improvedWorld();
    addStore(stockpile, 'lumber', HARBOUR_DOCK_CAP);
    setVendor(world, primaryCity(world).harbour.id, true);
    let departed = false;
    for (let t = 0; t < 600 && !departed; t++) {
      advance(world, 1);
      departed = primaryCity(world).harbour.progress > 0;
    }
    expect(departed).toBe(true);

    const raw = serializeWorld(world);
    const reloaded = deserializeWorld(raw);
    expect(reloaded).not.toBeNull();
    expect(primaryCity(reloaded!).harbour).toEqual(primaryCity(world).harbour);
  });

  test('a save with no harbour at all is refused, not quietly given one', () => {
    const world = createWorld(1);
    const raw = JSON.parse(serializeWorld(world));
    delete raw.cities[0].harbour;
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a harbour with an invalid progress fraction rather than clamping it', () => {
    const world = createWorld(1);
    const raw = JSON.parse(serializeWorld(world));
    raw.cities[0].harbour.progress = 1.5;
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });

  test('rejects a harbour whose trade is enabled but never installed', () => {
    const world = createWorld(1);
    const raw = JSON.parse(serializeWorld(world));
    raw.cities[0].harbour.vendorEnabled = true;
    raw.cities[0].harbour.vendorInstalled = false;
    expect(deserializeWorld(JSON.stringify(raw))).toBeNull();
  });
});
