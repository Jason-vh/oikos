import { expect, test } from 'bun:test';
import * as T from 'three';
import { ClaimOverlay } from './claims';
import type { Stage } from './stage';
import { islandFor } from '../sim/island';
import { createSharedWorld } from '../sim/world';
import { claimHarbour } from '../sim/claims';
import { findHarbourSite } from '../sim/founding';
import type { World } from '../sim/types';

function fixture() {
  const scene = new T.Scene();
  const stage = { scene, invalidate() {} } as Stage;
  const world = createSharedWorld();
  return { overlay: new ClaimOverlay(stage, islandFor(world.seed)), world, scene };
}

function claim(world: World, home: number, color: 'terracotta' | 'lapis') {
  const site = findHarbourSite(islandFor(world.seed), home)!;
  expect(claimHarbour(world, `City ${home}`, color, site.x, site.z, site.rotation).ok).toBe(true);
}

test('only claimed islands are marked, and a new claim joins them', () => {
  const { overlay, world } = fixture();
  try {
    claim(world, 0, 'terracotta');
    overlay.update(world, true);
    expect(overlay.claimedIslands).toBe(1);

    claim(world, 3, 'lapis');
    overlay.update(world, true);
    expect(overlay.claimedIslands).toBe(2);
  } finally {
    overlay.dispose();
  }
});

test('the marks are taken down once the player has a city of their own', () => {
  const { overlay, world } = fixture();
  try {
    claim(world, 0, 'terracotta');
    overlay.update(world, true);
    overlay.fade(900);
    expect(overlay.claimedIslands).toBe(1);

    overlay.update(world, false);
    expect(overlay.claimedIslands).toBe(0);
  } finally {
    overlay.dispose();
  }
});

test('the glaze is full across the archipelago and gone by street level', () => {
  const { overlay, world, scene } = fixture();
  try {
    claim(world, 0, 'terracotta');
    overlay.update(world, true);
    const mark = () => scene.getObjectByProperty('type', 'Group')!.children[0] as T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>;

    expect(overlay.fade(1300)).toBe(true);
    const wide = mark().material.opacity;
    expect(wide).toBeGreaterThan(.4);

    expect(overlay.fade(1300)).toBe(false);
    expect(overlay.fade(60)).toBe(true);
    expect(mark().material.opacity).toBe(0);
    expect(mark().parent!.visible).toBe(false);
  } finally {
    overlay.dispose();
  }
});
