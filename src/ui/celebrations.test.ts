import { expect, test } from 'bun:test';
import { createWorld } from '../sim/world';
import { celebration, cityMilestones, rememberMilestones, type CityMilestones } from './celebrations';

const empty: CityMilestones = { settled: false, delivered: false, courtyard: false, thriving: false };

test('an empty island has no achievements', () => {
  expect(cityMilestones(createWorld())).toEqual(empty);
  expect(celebration(empty, empty)).toBeNull();
});

test('settlers trigger one welcome, not one per household', () => {
  const settled = { ...empty, settled: true };
  expect(celebration(empty, settled)?.sound).toBe('arrival');
  expect(celebration(settled, settled)).toBeNull();
});

test('celebrates only the most significant simultaneous achievement', () => {
  const completed = { settled: true, delivered: true, courtyard: true, thriving: true };
  expect(celebration(empty, completed)?.sound).toBe('goal');
});

test('a recovered neighbourhood does not repeatedly celebrate the same milestone', () => {
  const completed = { settled: true, delivered: true, courtyard: true, thriving: true };
  const remembered = rememberMilestones(completed, empty);
  expect(celebration(remembered, completed)).toBeNull();
});
