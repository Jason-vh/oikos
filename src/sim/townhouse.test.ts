import { describe, expect, test } from 'bun:test';
import { advance, build, buildingStatus, createWorld, getSummary, setVendor } from './world';
import { deserializeWorld, serializeWorld } from './save';
import { buildStarterNeighbourhood } from './scenario';
import { primaryCity } from './city';
import { connect, settleHouses, spotFor } from './testing';
import { islandFor } from './island';
import { HOUSE_CAPACITY, VENDOR_COST } from './catalog';
import { PRESS_BATCH_OIL } from './balance';
import type { Building, World } from './types';

function runUntil(world: World, seconds: number, done: () => boolean): boolean {
  for (let step = 0; step < seconds * 4 && !done(); step++) advance(world, .25);
  return done();
}

function oilCity(world: World): { agora: Building; press: Building } {
  const city = primaryCity(world);
  expect(buildStarterNeighbourhood(world, city).ok).toBe(true);
  settleHouses(world, city, 3, 24);
  const entry = islandFor(world.seed, city.home).entry;
  const orchardSpot = spotFor(world, 'orchard', entry)!;
  expect(build(world, city, 'orchard', orchardSpot.x, orchardSpot.z).ok).toBe(true);
  expect(connect(world, city.buildings[city.buildings.length - 1]).ok).toBe(true);
  const pressSpot = spotFor(world, 'press', orchardSpot)!;
  expect(build(world, city, 'press', pressSpot.x, pressSpot.z).ok).toBe(true);
  const press = city.buildings[city.buildings.length - 1];
  expect(connect(world, press).ok).toBe(true);
  const agora = city.buildings.find((building) => building.kind === 'agora')!;
  expect(setVendor(city, agora.id, true, 'oil').ok).toBe(true);
  return { agora, press };
}

describe('the agora hosts stalls', () => {
  test('the food stall and the oil stall are bought and paused apart', () => {
    const world = createWorld(1);
    const city = primaryCity(world);
    const spot = spotFor(world, 'agora')!;
    expect(build(world, city, 'agora', spot.x, spot.z).ok).toBe(true);
    const agora = city.buildings[city.buildings.length - 1];
    const before = city.money;
    expect(setVendor(city, agora.id, true).ok).toBe(true);
    expect(city.money).toBe(before - VENDOR_COST);
    expect(setVendor(city, agora.id, true, 'oil').ok).toBe(true);
    expect(city.money).toBe(before - VENDOR_COST * 2);
    expect(setVendor(city, agora.id, false, 'oil').ok).toBe(true);
    expect(agora.stalls.food?.enabled).toBe(true);
    expect(agora.stalls.oil?.enabled).toBe(false);
    expect(setVendor(city, agora.id, true, 'oil').ok).toBe(true);
    expect(city.money).toBe(before - VENDOR_COST * 2);
  });

  test('an older save turns its single vendor into the food stall', () => {
    const world = createWorld(1);
    const city = primaryCity(world);
    expect(buildStarterNeighbourhood(world, city).ok).toBe(true);
    advance(world, 60);
    const raw = JSON.parse(serializeWorld(world));
    for (const building of raw.cities[0].buildings) {
      if (building.kind !== 'agora') continue;
      building.vendorInstalled = true;
      building.vendorEnabled = true;
      delete building.stalls;
    }
    for (const building of raw.cities[0].buildings) delete building.oil;
    raw.version = 17;
    const restored = deserializeWorld(JSON.stringify(raw))!;
    expect(restored).not.toBeNull();
    const agora = primaryCity(restored).buildings.find((building) => building.kind === 'agora')!;
    expect(agora.stalls.food).toEqual({ installed: true, enabled: true });
    expect(agora.vendorInstalled).toBe(false);
    expect(primaryCity(restored).buildings.every((building) => building.oil === 0)).toBe(true);
  });
});

describe('oil and the townhouse', () => {
  test('oil reaches houses from a press by way of the agora, and a courtyard house becomes a townhouse', () => {
    const world = createWorld(1);
    const city = primaryCity(world);
    const { agora, press } = oilCity(world);
    expect(runUntil(world, 900, () => (press.stores.oil ?? 0) >= PRESS_BATCH_OIL)).toBe(true);
    expect(runUntil(world, 600, () => (agora.stores.oil ?? 0) > 0)).toBe(true);
    const houses = city.buildings.filter((building) => building.kind === 'house');
    expect(runUntil(world, 600, () => houses.some((house) => house.oil > 0))).toBe(true);
    expect(runUntil(world, 900, () => getSummary(city).townhouses > 0)).toBe(true);
    const townhouse = houses.find((house) => house.tier === 4)!;
    expect(HOUSE_CAPACITY[townhouse.tier]).toBe(28);
    expect(runUntil(world, 600, () => townhouse.residents > 20)).toBe(true);
  });

  test('a townhouse starved of oil says so and slips back to a courtyard house', () => {
    const world = createWorld(1);
    const city = primaryCity(world);
    const { agora } = oilCity(world);
    expect(runUntil(world, 1800, () => getSummary(city).townhouses > 0)).toBe(true);
    const townhouse = city.buildings.find((house) => house.kind === 'house' && house.tier === 4)!;
    expect(setVendor(city, agora.id, false, 'oil').ok).toBe(true);
    townhouse.oil = 0;
    advance(world, 1);
    expect(buildingStatus(world, city, townhouse)[0]).toBe('Out of oil; no agora oil stall is serving the streets.');
    expect(runUntil(world, 120, () => townhouse.tier === 3)).toBe(true);
    expect(townhouse.residents).toBeLessThanOrEqual(HOUSE_CAPACITY[3]);
  });

  test('the starter goal still counts courtyard houses, townhouses and all', () => {
    const world = createWorld(1);
    const city = primaryCity(world);
    expect(buildStarterNeighbourhood(world, city).ok).toBe(true);
    expect(runUntil(world, 600, () => getSummary(city).goal)).toBe(true);
    for (const house of city.buildings.filter((building) => building.kind === 'house')) {
      if (house.tier === 3) house.tier = 4;
    }
    expect(getSummary(city).prosperous).toBeGreaterThanOrEqual(4);
    expect(getSummary(city).goal).toBe(true);
  });
});
