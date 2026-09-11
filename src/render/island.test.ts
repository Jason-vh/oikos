import { expect, test } from 'bun:test';
import * as T from 'three';
import { generateIsland } from '../sim/island';
import { IslandScenery } from './island';

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
