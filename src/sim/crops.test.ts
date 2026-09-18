import { describe, expect, test } from 'bun:test';
import { advance, build, buildingStatus, createWorld, demolish, placement } from './world';
import { primaryCity } from './city';
import { connect, growerSpotFor, settleHouses, sow, spotFor } from './testing';
import { fieldCapacity, fieldReach, fieldReport, openFields, plant, plantPlacement, tendedFields } from './crops';
import { mapOf } from './grid';
import { terrainOn, tileAtOn, tileIndexOn } from './island';
import { CROP_YIELD } from './balance';
import type { Building, City, Tile, World } from './types';

function farmstead(world: World, kind: 'farm' | 'orchard' = 'farm'): Building {
  const city = primaryCity(world);
  const spot = growerSpotFor(world, kind)!;
  expect(spot).not.toBeNull();
  expect(build(world, city, kind, spot.x, spot.z).ok).toBe(true);
  const grower = city.buildings[city.buildings.length - 1];
  expect(connect(world, grower).ok).toBe(true);
  return grower;
}

function tileOf(world: World, city: City, tile: number): Tile {
  return tileAtOn(mapOf(world, city), tile);
}

describe('sowing fields', () => {
  test('a field needs fertile soil inside the farmstead\'s reach', () => {
    const world = createWorld();
    const city = primaryCity(world);
    const farm = farmstead(world);
    const map = mapOf(world, city);
    const reach = new Set(fieldReach(world, city, farm));

    const good = tileOf(world, city, openFields(world, city, farm)[0]);
    expect(plantPlacement(world, city, farm, [good]).ok).toBe(true);

    const barren = [...reach].find((tile) => terrainOn(map, tile % map.width, Math.floor(tile / map.width)) !== 'fertile')!;
    expect(plantPlacement(world, city, farm, [tileOf(world, city, barren)]).reason).toBe('Crops root only in fertile soil.');

    const distant = { x: farm.x + 40, z: farm.z + 40 };
    expect(plantPlacement(world, city, farm, [distant]).reason).toBe('Too far from the farmstead for anyone to tend.');
  });

  test('a sown tile is taken: nothing is built or paved over it, and only the wrecking tool clears it', () => {
    const world = createWorld();
    const city = primaryCity(world);
    const farm = farmstead(world);
    const field = tileOf(world, city, openFields(world, city, farm)[0]);
    expect(plant(world, city, farm.id, [field]).ok).toBe(true);

    expect(placement(world, city, 'house', field.x, field.z).reason).toBe('A field is sown there; clear it first.');
    expect(placement(world, city, 'road', field.x, field.z).reason).toBe('A field is sown there; clear it first.');
    expect(plantPlacement(world, city, farm, [field]).reason).toBe('Something already grows there.');

    expect(demolish(world, city, field.x, field.z).reason).toBe('Field cleared.');
    expect(city.crops).toHaveLength(0);
    expect(plantPlacement(world, city, farm, [field]).ok).toBe(true);
  });

  test('sowing many at once sows every tile it can and refuses the rest', () => {
    const world = createWorld();
    const city = primaryCity(world);
    const farm = farmstead(world);
    const map = mapOf(world, city);
    const open = openFields(world, city, farm).slice(0, 4).map((tile) => tileAtOn(map, tile));
    const barren = fieldReach(world, city, farm).find((tile) => terrainOn(map, tile % map.width, Math.floor(tile / map.width)) !== 'fertile')!;
    const result = plant(world, city, farm.id, [...open, tileAtOn(map, barren)]);
    expect(result.ok).toBe(true);
    expect(result.tiles).toHaveLength(4);
    expect(result.blocked).toEqual([barren]);
    expect(city.crops.map((crop) => crop.kind)).toEqual(['wheat', 'wheat', 'wheat', 'wheat']);
  });
});

describe('tending fields', () => {
  test('a farmstead tends up to its capacity and says how many it works', () => {
    const world = createWorld();
    const city = primaryCity(world);
    settleHouses(world, city, 3, 40);
    const farm = farmstead(world);
    const map = mapOf(world, city);
    const wanted = openFields(world, city, farm).slice(0, fieldCapacity('farm') + 3).map((tile) => tileAtOn(map, tile));
    expect(wanted.length).toBe(fieldCapacity('farm') + 3);
    expect(plant(world, city, farm.id, wanted).ok).toBe(true);
    advance(world, 1);

    const report = fieldReport(world, city, farm);
    expect(report.planted).toBe(fieldCapacity('farm') + 3);
    expect(report.tended).toBe(fieldCapacity('farm'));
    expect(buildingStatus(world, city, farm).join(' ')).toContain('3 fields beyond what these hands can work');
  });

  test('two farmsteads share the fields between them rather than working the same ground twice', () => {
    const world = createWorld();
    const city = primaryCity(world);
    settleHouses(world, city, 3, 40);
    city.money = 5000;
    const first = farmstead(world);
    expect(sow(world, first)).toBe(fieldCapacity('farm'));
    const second = farmstead(world);
    const map = mapOf(world, city);
    const spare = openFields(world, city, second).slice(0, fieldCapacity('farm')).map((tile) => tileAtOn(map, tile));
    expect(plant(world, city, second.id, spare).ok).toBe(true);
    advance(world, 1);

    const tended = tendedFields(world, city);
    const mine = tended.get(first.id)!;
    const theirs = tended.get(second.id)!;
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);
    expect(mine.some((tile) => theirs.includes(tile))).toBe(false);
  });

  test('an unstaffed or unconnected farmstead tends nothing', () => {
    const world = createWorld();
    const city = primaryCity(world);
    const farm = farmstead(world);
    sow(world, farm);
    farm.connected = false;
    advance(world, 1);
    expect(tendedFields(world, city).get(farm.id)).toEqual([]);
    expect(buildingStatus(world, city, farm)).toEqual(['Not linked to a road; nobody can reach it.']);
  });
});

describe('the harvest', () => {
  test('ripe fields fill the farmstead and start again', () => {
    const world = createWorld();
    const city = primaryCity(world);
    settleHouses(world, city, 3, 40);
    const farm = farmstead(world);
    expect(sow(world, farm)).toBe(fieldCapacity('farm'));
    const granary = spotFor(world, 'granary', { x: farm.x, z: farm.z })!;
    expect(build(world, city, 'granary', granary.x, granary.z).ok).toBe(true);
    expect(connect(world, city.buildings[city.buildings.length - 1]).ok).toBe(true);

    const harvested = () => city.produced;
    for (let step = 0; step < 4 * 200 && harvested() === 0; step++) advance(world, .25);
    expect(harvested()).toBeGreaterThanOrEqual(CROP_YIELD);
    expect(city.crops.every((crop) => crop.progress < 1)).toBe(true);
    expect(city.crops).toHaveLength(fieldCapacity('farm'));
  });

  test('olives grow slower than wheat on the same soil', () => {
    const world = createWorld();
    const city = primaryCity(world);
    settleHouses(world, city, 3, 40);
    city.money = 5000;
    const orchard = farmstead(world, 'orchard');
    expect(sow(world, orchard)).toBeGreaterThan(0);
    const farm = farmstead(world);
    expect(sow(world, farm)).toBeGreaterThan(0);
    const wheat = city.crops.find((crop) => crop.kind === 'wheat')!;
    const olives = city.crops.find((crop) => crop.kind === 'olives')!;
    const sownWheat = wheat.progress;
    const sownOlives = olives.progress;
    advance(world, 30);

    expect(wheat.progress - sownWheat).toBeGreaterThan(olives.progress - sownOlives);
  });
});

describe('the tending ring', () => {
  test('reaches around the farmstead without crossing water, buildings or a terrace', () => {
    const world = createWorld();
    const city = primaryCity(world);
    const farm = farmstead(world);
    const map = mapOf(world, city);
    const reach = fieldReach(world, city, farm);

    expect(reach.length).toBeGreaterThan(20);
    for (const tile of reach) {
      const { x, z } = tileAtOn(map, tile);
      expect(terrainOn(map, x, z)).not.toBe('water');
      expect(Math.abs(x - farm.x) + Math.abs(z - farm.z)).toBeLessThanOrEqual(16);
    }
    for (const tile of city.buildings.flatMap((building) => [tileIndexOn(map, building.x, building.z)])) {
      expect(reach).not.toContain(tile);
    }
  });
});
