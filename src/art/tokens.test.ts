import { expect, test } from 'bun:test';
import * as T from 'three';
import { errandToken } from './tokens';
import type { Errand, Resource } from '../sim/types';

const ERRANDS: Errand[] = ['water', 'food', 'repair'];
const MAX_SPREAD = .9;
const MAX_HEIGHT = .9;

function size(model: T.Group): T.Vector3 {
  return new T.Box3().setFromObject(model).getSize(new T.Vector3());
}

test('every errand token sits on its own origin and fits inside a tile', () => {
  const resources: Resource[] = ['wheat', 'fish', 'lumber'];
  const tokens = [...ERRANDS.map((errand) => errandToken(errand)), ...resources.map((resource) => errandToken('goods', resource))];
  for (const token of tokens) {
    const bounds = new T.Box3().setFromObject(token);
    const spread = size(token);
    expect(Math.abs(bounds.min.y)).toBeLessThan(.05);
    expect(bounds.max.y).toBeGreaterThan(.2);
    expect(Math.abs(bounds.min.x + bounds.max.x)).toBeLessThan(.4);
    expect(spread.y).toBeLessThanOrEqual(MAX_HEIGHT);
    expect(Math.max(spread.x, spread.z)).toBeLessThanOrEqual(MAX_SPREAD);
  }
});

test('an errand reads by its own token, not by a shared silhouette', () => {
  const shapes = new Set(ERRANDS.map((errand) => {
    const spread = size(errandToken(errand));
    return `${spread.x.toFixed(2)}:${spread.y.toFixed(2)}`;
  }));
  expect(shapes.size).toBe(ERRANDS.length);
});

test('goods tokens carry the resource they deliver', () => {
  const wheat = size(errandToken('goods', 'wheat'));
  const fish = size(errandToken('goods', 'fish'));
  expect(wheat.y).not.toBe(fish.y);
});
