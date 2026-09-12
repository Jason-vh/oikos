import { expect, test } from 'bun:test';
import { advance, build, createWorld, demolish } from './world';
import { buildStarterNeighbourhood } from './scenario';
import { spotFor } from './testing';
import { canUndoConstruction, undoConstruction } from './history';
import { primaryCity } from './city';

test('undoing construction restores its cost without rewinding simulated time', () => {
  const world = createWorld();
  const before = structuredClone(world);
  const spot = spotFor(world, 'house')!;
  expect(build(world, primaryCity(world), 'house', spot.x, spot.z).ok).toBe(true);
  advance(world, 4.1);
  const expected = structuredClone(before);
  advance(expected, 4.1);
  expect(undoConstruction(world, before)).toEqual(expected);
  expect(undoConstruction(world, before)?.time).toBe(world.time);
});

test('undoing demolition resimulates the intact city without duplicating deliveries or refunds', () => {
  const world = createWorld();
  expect(buildStarterNeighbourhood(world).ok).toBe(true);
  advance(world, 180);
  const before = structuredClone(world);
  const granary = primaryCity(world).buildings.find((building) => building.kind === 'granary')!;
  expect(demolish(world, primaryCity(world), granary.x, granary.z).ok).toBe(true);
  advance(world, 10);
  const expected = structuredClone(before);
  advance(expected, 10);
  expect(undoConstruction(world, before)).toEqual(expected);
  expect(before.time).toBe(180);
});

test('undo expires after fifteen simulated seconds and cannot cross islands', () => {
  const world = createWorld();
  const before = structuredClone(world);
  advance(world, 15);
  expect(canUndoConstruction(world, before)).toBe(true);
  advance(world, .25);
  expect(undoConstruction(world, before)).toBeNull();
  expect(undoConstruction(createWorld(2), before)).toBeNull();
  expect(undoConstruction(before, world)).toBeNull();
  expect(undoConstruction(world, null)).toBeNull();
});

test('undo cannot cross into a checkpoint from a different city', () => {
  const world = createWorld();
  const before = structuredClone(world);
  primaryCity(before).id = primaryCity(world).id + 1;
  expect(canUndoConstruction(world, before)).toBe(false);
  expect(undoConstruction(world, before)).toBeNull();
});
