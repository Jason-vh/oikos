import { describe, expect, test } from 'bun:test';
import { demolitionPreview, footprintTileIssues, harbourRoute, suitableFarmGround } from './construction';
import { BUILDINGS, VENDOR_COST } from './catalog';
import { tileAtOn, tileIndexOn, terrainOn } from './island';
import { entryTileIndex } from './grid';
import { build, createWorld, setVendor } from './world';
import { freshRoadSpot, mapOf, spotFor } from './testing';
import { primaryCity } from './city';

const FOOTPRINT_SEED = 5_551_212;

describe('suitableFarmGround', () => {
  test('lists open fertile ground and drops it once occupied', () => {
    const world = createWorld();
    const spot = spotFor(world, 'farm')!;
    const before = suitableFarmGround(world, primaryCity(world));
    expect(before.some((tile) => tile.x === spot.x && tile.z === spot.z)).toBe(true);
    expect(build(world, primaryCity(world), 'farm', spot.x, spot.z).ok).toBe(true);
    const after = suitableFarmGround(world, primaryCity(world));
    expect(after.some((tile) => tile.x === spot.x && tile.z === spot.z)).toBe(false);
    expect(after.every((tile) => terrainOn(mapOf(world), tile.x, tile.z) === 'fertile')).toBe(true);
  });

  test('excludes tiles under existing roads', () => {
    const world = createWorld();
    const map = mapOf(world);
    const road = primaryCity(world).roads[0];
    const { x, z } = tileAtOn(map, road);
    const tiles = suitableFarmGround(world, primaryCity(world));
    expect(tiles.some((tile) => tile.x === x && tile.z === z)).toBe(false);
  });
});

describe('footprintTileIssues', () => {
  test('marks every tile clear when the whole footprint is buildable', () => {
    const world = createWorld();
    const spot = spotFor(world, 'granary')!;
    const issues = footprintTileIssues(world, primaryCity(world), 'granary', spot.x, spot.z, 0);
    expect(issues.length).toBe(9);
    expect(issues.every((tile) => !tile.blocked)).toBe(true);
  });

  test('flags only the specific tiles blocking a footprint', () => {
    const world = createWorld(FOOTPRINT_SEED);
    const spot = spotFor(world, 'house')!;
    const map = mapOf(world);
    const target = { x: spot.x + 1, z: spot.z + 1 };
    map.terrain[tileIndexOn(map, target.x, target.z)] = 'water';
    const issues = footprintTileIssues(world, primaryCity(world), 'house', spot.x, spot.z, 0);
    const blocked = issues.filter((tile) => tile.blocked);
    expect(blocked).toEqual([{ x: target.x, z: target.z, blocked: true }]);
    expect(issues.length).toBe(9);
  });
});

describe('harbourRoute', () => {
  test('finds a route from the harbour entry to a road-adjacent target', () => {
    const world = createWorld();
    const entry = entryTileIndex(world, primaryCity(world));
    const road = primaryCity(world).roads[primaryCity(world).roads.length - 1];
    const route = harbourRoute(world, primaryCity(world), [road]);
    expect(route).not.toBeNull();
    expect(route![0]).toBe(entry);
    expect(primaryCity(world).roads.includes(route![route!.length - 1])).toBe(true);
  });

  test('returns null when nothing connects to the harbour', () => {
    const world = createWorld();
    primaryCity(world).roads = [];
    const spot = spotFor(world, 'house')!;
    const map = mapOf(world);
    const route = harbourRoute(world, primaryCity(world), [tileIndexOn(map, spot.x, spot.z)]);
    expect(route).toBeNull();
  });

  test('returns null for an empty set of tiles', () => {
    const world = createWorld();
    expect(harbourRoute(world, primaryCity(world), [])).toBeNull();
  });
});

describe('demolitionPreview', () => {
  test('reports half the base cost for a plain building', () => {
    const world = createWorld();
    const spot = spotFor(world, 'house')!;
    build(world, primaryCity(world), 'house', spot.x, spot.z);
    const preview = demolitionPreview(world, primaryCity(world), spot.x, spot.z);
    expect(preview?.kind).toBe('house');
    expect(preview?.refund).toBe(Math.floor(BUILDINGS.house.cost / 2));
  });

  test('includes the vendor fee once installed on an agora', () => {
    const world = createWorld();
    const spot = spotFor(world, 'agora')!;
    build(world, primaryCity(world), 'agora', spot.x, spot.z);
    const agora = primaryCity(world).buildings.find((building) => building.kind === 'agora')!;
    setVendor(primaryCity(world), agora.id, true);
    const preview = demolitionPreview(world, primaryCity(world), spot.x, spot.z);
    expect(preview?.refund).toBe(Math.floor((BUILDINGS.agora.cost + VENDOR_COST) / 2));
  });

  test('reports no refund for a road tile', () => {
    const world = createWorld();
    const map = mapOf(world);
    const road = primaryCity(world).roads[0];
    const { x, z } = tileAtOn(map, road);
    const preview = demolitionPreview(world, primaryCity(world), x, z);
    expect(preview?.kind).toBe('road');
    expect(preview?.refund).toBe(0);
  });

  test('returns null for empty ground', () => {
    const world = createWorld();
    const spot = freshRoadSpot(world)!;
    expect(demolitionPreview(world, primaryCity(world), spot.x, spot.z)).toBeNull();
  });
});
