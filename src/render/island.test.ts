import { expect, test } from 'bun:test';
import * as T from 'three';
import { generateIsland, tileAtOn, worldPositionOn, CELL_SIZE } from '../sim/island';
import { bushForTile } from '../art/bushes';
import { IslandScenery } from './island';

function hiddenTiles(scenery: IslandScenery): number[] {
  return scenery.decorTiles().filter((tile) => scenery.decorHidden(tile));
}

test('scrub clears only on occupied tiles and returns in the same pose', () => {
  const map = generateIsland(1);
  const scenery = new IslandScenery(new T.Scene(), map);
  scenery.reveal(null);
  try {
    const index = map.terrain.findIndex((terrain, tile) => {
      if (terrain !== 'scrub') return false;
      const { x, z } = tileAtOn(map, tile);
      return bushForTile(map, x, z) !== null;
    });
    expect(index).toBeGreaterThanOrEqual(0);
    scenery.clearDecor(new Set([index]), new Set());
    expect(hiddenTiles(scenery)).toEqual([index]);
    const before = scenery.decorBounds(index)!;
    const { x, z } = tileAtOn(map, index);
    const corner = worldPositionOn(map, x, z);
    expect(before.min.x).toBeGreaterThan(corner.x);
    expect(before.max.x).toBeLessThan(corner.x + CELL_SIZE);
    expect(before.min.z).toBeGreaterThan(corner.z);
    expect(before.max.z).toBeLessThan(corner.z + CELL_SIZE);
    scenery.clearDecor(new Set(), new Set());
    expect(scenery.decorHidden(index)).toBe(false);
    expect(scenery.decorBounds(index)).toEqual(before);
    expect(scenery.animateFalls(1)).toBe(false);
  } finally {
    scenery.dispose();
  }
});

test('clifftop decoration clears for roads and returns when they are removed', () => {
  const map = generateIsland(1);
  const before = structuredClone(map);
  const scenery = new IslandScenery(new T.Scene(), map);
  scenery.reveal(null);
  try {
    const cliffTiles = new Set(map.terrain.flatMap((terrain, tile) => terrain === 'cliff' ? [tile] : []));
    scenery.clearDecor(cliffTiles, new Set());
    const cleared = hiddenTiles(scenery);
    expect(cleared.length).toBeGreaterThan(0);
    expect(cleared.every((tile) => cliffTiles.has(tile))).toBe(true);
    scenery.clearDecor(new Set(), new Set());
    expect(hiddenTiles(scenery)).toHaveLength(0);
    expect(scenery.animateFalls(1)).toBe(false);
    expect(map).toEqual(before);
  } finally {
    scenery.dispose();
  }
});

test('felled forest leans from its own tile and disappears once it has settled', () => {
  const map = generateIsland(1);
  const scenery = new IslandScenery(new T.Scene(), map);
  scenery.reveal(null);
  try {
    const tile = map.terrain.findIndex((terrain) => terrain === 'forest');
    expect(scenery.decorTiles()).toContain(tile);
    const standing = scenery.decorBounds(tile)!;
    const { x, z } = tileAtOn(map, tile);
    const centre = worldPositionOn(map, x + .5, z + .5);
    scenery.clearDecor(new Set(), new Set([tile]));
    expect(scenery.animateFalls(1.1)).toBe(true);
    const leaning = scenery.decorBounds(tile)!;
    expect(leaning).not.toEqual(standing);
    expect(leaning.max.y).toBeLessThan(standing.max.y);
    const reach = Math.max(standing.max.y - standing.min.y, CELL_SIZE) * 1.5;
    expect(leaning.distanceToPoint(new T.Vector3(centre.x, leaning.min.y, centre.z))).toBeLessThan(reach);
    expect(scenery.animateFalls(2.2)).toBe(false);
    expect(scenery.decorHidden(tile)).toBe(true);
  } finally {
    scenery.dispose();
  }
});

test('decoration draws as instanced batches per chunk, each cullable on its own', () => {
  const map = generateIsland(1);
  const scenery = new IslandScenery(new T.Scene(), map);
  scenery.reveal(null);
  try {
    const batches: T.InstancedMesh[] = [];
    let meshes = 0;
    scenery.root.traverse((child) => {
      if (!(child as T.Mesh).isMesh) return;
      meshes++;
      if ((child as T.InstancedMesh).isInstancedMesh) batches.push(child as T.InstancedMesh);
    });
    expect(scenery.decorTiles().length).toBeGreaterThan(400);
    expect(meshes).toBeLessThan(scenery.decorTiles().length / 10);
    expect(batches.length).toBeGreaterThan(0);
    for (const batch of batches) {
      expect(batch.frustumCulled).toBe(true);
      expect(batch.boundingSphere).not.toBeNull();
      expect(batch.boundingSphere!.radius).toBeLessThan(60);
    }
  } finally {
    scenery.dispose();
  }
});
