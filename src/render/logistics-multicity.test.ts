import { expect, test } from 'bun:test';
import * as T from 'three';
import { LogisticsOverlay } from './logistics';
import { islandFor } from '../sim/island';
import { createWorld } from '../sim/world';
import { buildStarterNeighbourhood } from '../sim/scenario';
import { primaryCity } from '../sim/city';
import { foundSecondCity } from '../sim/testing';

test('the overlay resolves a building route by searching every city, not just the first', () => {
  const world = createWorld(1, 0);
  const city1 = primaryCity(world);
  const city2 = foundSecondCity(world, (city1.home + 1) % 8);
  expect(buildStarterNeighbourhood(world, city2).ok).toBe(true);
  const fountain = city2.buildings.find((building) => building.kind === 'fountain')!;

  const scene = new T.Scene();
  const overlay = new LogisticsOverlay(scene, islandFor(world.seed));
  try {
    overlay.update(world, fountain.id, null);
    expect(overlay.counts.route).toBeGreaterThan(0);
    overlay.update(world, null, null);
    expect(overlay.counts.route).toBe(0);
  } finally {
    overlay.dispose();
  }
});

test('an unknown building or walker id clears a previously drawn route instead of throwing', () => {
  const world = createWorld(1, 0);
  const city1 = primaryCity(world);
  const city2 = foundSecondCity(world, (city1.home + 1) % 8);
  expect(buildStarterNeighbourhood(world, city2).ok).toBe(true);
  const fountain = city2.buildings.find((building) => building.kind === 'fountain')!;

  const scene = new T.Scene();
  const overlay = new LogisticsOverlay(scene, islandFor(world.seed));
  try {
    overlay.update(world, fountain.id, null);
    expect(overlay.counts.route).toBeGreaterThan(0);
    expect(() => overlay.update(world, 999999, null)).not.toThrow();
    expect(overlay.counts.route).toBe(0);

    overlay.update(world, fountain.id, null);
    expect(overlay.counts.route).toBeGreaterThan(0);
    expect(() => overlay.update(world, null, 999999)).not.toThrow();
    expect(overlay.counts.route).toBe(0);
  } finally {
    overlay.dispose();
  }
});
