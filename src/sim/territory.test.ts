import { expect, test } from 'bun:test';
import { footprintTileIssues } from './construction';
import { deserializeWorld, serializeWorld } from './save';
import { openLadder, spotFor } from './testing';
import type { BuildTool } from './types';
import { build, createWorld, demolish, placement, placeRoadPath, roadPathPlacement } from './world';
import { primaryCity } from './city';

const TOOLS: BuildTool[] = ['road', 'house', 'farm', 'granary', 'agora', 'fountain', 'maintenance', 'lodge', 'woodcutter', 'stockpile'];

for (const tool of TOOLS) {
  test(`${tool} placement refuses another island without charging or mutating`, () => {
    const world = createWorld(1, 0);
    const other = createWorld(1, 7);
    openLadder(world);
    openLadder(other);
    const spot = spotFor(other, tool)!;
    expect(spot).not.toBeNull();
    expect(placement(other, primaryCity(other), tool, spot.x, spot.z).ok).toBe(true);
    const before = serializeWorld(world);
    const preview = placement(world, primaryCity(world), tool, spot.x, spot.z);
    expect(preview.ok).toBe(false);
    expect(preview.reason).toContain('settled island');
    expect(build(world, primaryCity(world), tool, spot.x, spot.z).ok).toBe(false);
    expect(serializeWorld(world)).toBe(before);
    if (tool !== 'road') {
      expect(footprintTileIssues(world, primaryCity(world), tool, spot.x, spot.z, 0).every((tile) => tile.blocked)).toBe(true);
    }
  });
}

test('a road batch reaching an unsettled island is rejected atomically', () => {
  const world = createWorld(2, 7);
  const other = createWorld(2, 0);
  const local = spotFor(world, 'road')!;
  const foreign = spotFor(other, 'road')!;
  const before = serializeWorld(world);
  const tiles = [local, foreign];
  expect(roadPathPlacement(world, primaryCity(world), tiles).reason).toContain('settled island');
  expect(placeRoadPath(world, primaryCity(world), tiles).ok).toBe(false);
  expect(serializeWorld(world)).toBe(before);
});

test('legacy outlying construction remains loadable and can be removed', () => {
  const world = createWorld(1, 0);
  const other = createWorld(1, 7);
  const spot = spotFor(other, 'house')!;
  expect(build(other, primaryCity(other), 'house', spot.x, spot.z).ok).toBe(true);
  const building = { ...primaryCity(other).buildings[0], id: world.nextId++, connected: false };
  primaryCity(world).buildings.push(building);
  const loaded = deserializeWorld(serializeWorld(world));
  expect(loaded).not.toBeNull();
  expect(primaryCity(loaded!).buildings).toContainEqual(building);
  expect(demolish(loaded!, primaryCity(loaded!), spot.x, spot.z).ok).toBe(true);
  expect(primaryCity(loaded!).buildings).toHaveLength(0);
});
