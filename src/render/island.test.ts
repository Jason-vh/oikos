import { expect, test } from 'bun:test';
import * as T from 'three';
import { generateIsland, tileAtOn, worldPositionOn, CELL_SIZE } from '../sim/island';
import { bushForTile } from '../art/bushes';
import { IslandScenery } from './island';

test('scrub clears only on occupied tiles and returns in the same pose', () => {
  const map = generateIsland(1);
  const scenery = new IslandScenery(new T.Scene(), map);
  try {
    const index = map.terrain.findIndex((terrain, tile) => {
      if (terrain !== 'scrub') return false;
      const { x, z } = tileAtOn(map, tile);
      return bushForTile(map, x, z) !== null;
    });
    expect(index).toBeGreaterThanOrEqual(0);
    scenery.clearDecor(new Set([index]), new Set());
    const cleared = scenery.root.children.filter((child) => child !== scenery.grid && !child.visible);
    expect(cleared).toHaveLength(1);
    const plant = cleared[0];
    const before = new T.Box3().setFromObject(plant);
    const { x, z } = tileAtOn(map, index);
    const corner = worldPositionOn(map, x, z);
    expect(before.min.x).toBeGreaterThan(corner.x);
    expect(before.max.x).toBeLessThan(corner.x + CELL_SIZE);
    expect(before.min.z).toBeGreaterThan(corner.z);
    expect(before.max.z).toBeLessThan(corner.z + CELL_SIZE);
    scenery.clearDecor(new Set(), new Set());
    expect(plant.visible).toBe(true);
    expect(new T.Box3().setFromObject(plant)).toEqual(before);
    expect(scenery.animateFalls(1)).toBe(false);
  } finally {
    scenery.dispose();
  }
});

test('clifftop decoration clears for roads and returns when they are removed', () => {
  const map = generateIsland(1);
  const before = structuredClone(map);
  const scenery = new IslandScenery(new T.Scene(), map);
  try {
    const cliffTiles = new Set(map.terrain.flatMap((terrain, tile) => terrain === 'cliff' ? [tile] : []));
    scenery.clearDecor(cliffTiles, new Set());
    const cleared = scenery.root.children.filter((child) => child !== scenery.grid && !child.visible);
    expect(cleared.length).toBeGreaterThan(0);
    expect(scenery.root.children[0].visible).toBe(true);
    scenery.clearDecor(new Set(), new Set());
    expect(cleared.every((child) => child.visible)).toBe(true);
    expect(scenery.animateFalls(1)).toBe(false);
    expect(map).toEqual(before);
  } finally {
    scenery.dispose();
  }
});
