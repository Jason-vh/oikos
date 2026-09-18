import { describe, expect, test } from 'bun:test';
import { advance, build, createWorld, getSummary, setVendor } from './world';
import { buildStarterNeighbourhood } from './scenario';
import { primaryCity } from './city';
import { connect, growerSpotFor, sow, spotFor } from './testing';
import { islandFor } from './island';
import type { Building, City, World } from './types';

function runUntil(world: World, seconds: number, done: () => boolean): number {
  const started = world.time;
  for (let step = 0; step < seconds * 4 && !done(); step++) advance(world, .25);
  return done() ? world.time - started : Infinity;
}

function raise(world: World, city: City, kind: 'orchard' | 'press' | 'wharf' | 'lodge' | 'woodcutter' | 'stockpile', near = islandFor(world.seed, city.home).entry): Building | null {
  const spot = kind === 'orchard' ? growerSpotFor(world, kind, near) : spotFor(world, kind, near);
  if (!spot) return null;
  if (!build(world, city, kind, spot.x, spot.z).ok) return null;
  const raised = city.buildings[city.buildings.length - 1];
  connect(world, raised);
  sow(world, raised, city);
  return raised;
}

describe('the ladder keeps its pace', () => {
  for (let seed = 1; seed <= 8; seed++) {
    test(`seed ${seed}: a courtyard neighbourhood with an orchard and a press raises a townhouse within six minutes`, () => {
      const world = createWorld(seed);
      const city = primaryCity(world);
      expect(buildStarterNeighbourhood(world, city).ok).toBe(true);
      const courtyards = runUntil(world, 600, () => getSummary(city).prosperous >= 4);
      expect(courtyards).toBeLessThan(600);
      expect(raise(world, city, 'orchard')).not.toBeNull();
      expect(raise(world, city, 'press')).not.toBeNull();
      const agora = city.buildings.find((building) => building.kind === 'agora')!;
      expect(setVendor(city, agora.id, true, 'oil').ok).toBe(true);
      const risen = runUntil(world, 360, () => getSummary(city).townhouses > 0);
      expect(risen).toBeLessThan(360);
    });
  }

  for (let seed = 1; seed <= 8; seed++) {
    test(`seed ${seed}: a city that builds the whole ladder stays solvent on its own income`, () => {
      const world = createWorld(seed);
      const city = primaryCity(world);
      expect(buildStarterNeighbourhood(world, city).ok).toBe(true);
      expect(runUntil(world, 600, () => getSummary(city).prosperous >= 4)).toBeLessThan(600);
      for (const kind of ['wharf', 'lodge', 'woodcutter', 'stockpile', 'orchard', 'press'] as const) raise(world, city, kind);
      const agora = city.buildings.find((building) => building.kind === 'agora')!;
      setVendor(city, agora.id, true, 'oil');
      advance(world, 600);
      const summary = getSummary(city);
      expect(summary.balance).toBeGreaterThanOrEqual(0);
      expect(city.money).toBeGreaterThan(0);
    });
  }
});
