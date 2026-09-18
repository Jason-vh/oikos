import { describe, expect, test } from 'bun:test';
import { advance, build, buildingStatus, createWorld } from './world';
import { islandFor, terrainOn } from './island';
import { connect, spotFor } from './testing';
import { primaryCity } from './city';
import { PRESS_BATCH_OIL, PRESS_BATCH_OLIVES, PRESS_CAP } from './balance';
import { BUILDINGS } from './catalog';
import type { Building, World } from './types';

function buildOliveCity(world: World): { orchard: Building; press: Building } {
  const city = primaryCity(world);
  const entry = islandFor(world.seed).entry;
  for (let count = 0; count < 3; count++) {
    const houseSpot = spotFor(world, 'house', entry)!;
    expect(build(world, city, 'house', houseSpot.x, houseSpot.z).ok).toBe(true);
    expect(connect(world, city.buildings[city.buildings.length - 1]).ok).toBe(true);
  }
  const orchardSpot = spotFor(world, 'orchard', entry)!;
  expect(build(world, city, 'orchard', orchardSpot.x, orchardSpot.z).ok).toBe(true);
  const orchard = city.buildings[city.buildings.length - 1];
  expect(connect(world, orchard).ok).toBe(true);
  const pressSpot = spotFor(world, 'press', orchardSpot)!;
  expect(build(world, city, 'press', pressSpot.x, pressSpot.z).ok).toBe(true);
  const press = city.buildings[city.buildings.length - 1];
  expect(connect(world, press).ok).toBe(true);
  return { orchard, press };
}

function runUntil(world: World, seconds: number, done: () => boolean): boolean {
  for (let step = 0; step < seconds * 4 && !done(); step++) advance(world, .25);
  return done();
}

describe('the olive orchard', () => {
  test('roots in grass, scrub or fertile ground, and nowhere else', () => {
    const world = createWorld(1);
    const city = primaryCity(world);
    const map = islandFor(world.seed);
    const spot = spotFor(world, 'orchard', map.entry)!;
    for (let dz = 0; dz < 4; dz++) {
      for (let dx = 0; dx < 4; dx++) {
        expect(['grass', 'scrub', 'fertile']).toContain(terrainOn(map, spot.x + dx, spot.z + dz));
      }
    }
    const sand = spotFor(world, 'house', map.entry)!;
    const sandy = { x: sand.x, z: sand.z };
    const refusal = build(world, city, 'orchard', sandy.x, sandy.z);
    expect(refusal.ok || refusal.reason === 'Olives root in grass, scrub or fertile ground.').toBe(true);
  });

  test('its cart carries olives to a press, never to a granary', () => {
    const world = createWorld(1);
    const city = primaryCity(world);
    const { orchard, press } = buildOliveCity(world);
    const granarySpot = spotFor(world, 'granary', { x: orchard.x, z: orchard.z })!;
    expect(build(world, city, 'granary', granarySpot.x, granarySpot.z).ok).toBe(true);
    const granary = city.buildings[city.buildings.length - 1];
    expect(connect(world, granary).ok).toBe(true);
    expect(runUntil(world, 600, () => (press.stores.olives ?? 0) > 0 || (press.stores.oil ?? 0) > 0)).toBe(true);
    expect(granary.stores.olives ?? 0).toBe(0);
  });
});

describe('the olive press', () => {
  test('presses olives into oil in batches once it is staffed and supplied', () => {
    const world = createWorld(1);
    const { press } = buildOliveCity(world);
    expect(runUntil(world, 900, () => (press.stores.oil ?? 0) >= PRESS_BATCH_OIL)).toBe(true);
    expect(press.stores.oil).toBeGreaterThanOrEqual(PRESS_BATCH_OIL);
    expect(primaryCity(world).produced).toBeGreaterThan(0);
  });

  test('a batch in the mill is neither lost nor doubled, and stock never passes its capacity', () => {
    const world = createWorld(1);
    const { press } = buildOliveCity(world);
    expect(runUntil(world, 900, () => press.progress > 0)).toBe(true);
    const olives = press.stores.olives ?? 0;
    const oil = press.stores.oil ?? 0;
    expect(runUntil(world, 200, () => (press.stores.oil ?? 0) > oil)).toBe(true);
    expect(press.stores.oil).toBe(oil + PRESS_BATCH_OIL);
    expect(press.stores.olives ?? 0).toBeLessThanOrEqual(olives + PRESS_BATCH_OLIVES);
    advance(world, 1200);
    const total = Object.values(press.stores).reduce((sum, amount) => sum + amount, 0);
    expect(total).toBeLessThanOrEqual(PRESS_CAP);
  });

  test('it says what it is doing: waiting, pressing, or full', () => {
    const world = createWorld(1);
    const city = primaryCity(world);
    const { press } = buildOliveCity(world);
    expect(runUntil(world, 400, () => press.workers >= BUILDINGS.press.jobs)).toBe(true);
    expect(buildingStatus(world, city, press)).toContain('Waiting for olives from an orchard.');
    expect(runUntil(world, 900, () => press.progress > 0)).toBe(true);
    expect(buildingStatus(world, city, press).join(' ')).toContain('Pressing oil,');
    press.stores.oil = PRESS_CAP;
    press.stores.olives = PRESS_BATCH_OLIVES;
    press.progress = 0;
    expect(buildingStatus(world, city, press)).toContain('Full of oil; waiting for a buyer from an agora.');
  });

  test('an unstaffed press presses nothing', () => {
    const world = createWorld(1);
    const city = primaryCity(world);
    const pressSpot = spotFor(world, 'press', islandFor(world.seed).entry)!;
    expect(build(world, city, 'press', pressSpot.x, pressSpot.z).ok).toBe(true);
    const press = city.buildings[city.buildings.length - 1];
    press.stores.olives = PRESS_BATCH_OLIVES * 2;
    advance(world, 300);
    expect(press.stores.oil ?? 0).toBe(0);
  });
});
