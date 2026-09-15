import { expect, test } from 'bun:test';
import { animalModel, animateAnimal } from './animals';

function heights(stride: number): number {
  const model = animalModel('rabbit');
  model.position.y = 0;
  animateAnimal(model, 'rabbit', 0, true, stride);
  return model.position.y;
}

test('a hopping rabbit leaves the ground and lands on it again', () => {
  expect(heights(0)).toBeCloseTo(0, 9);
  expect(heights(1)).toBeCloseTo(0, 9);
  expect(heights(1 / 6)).toBeGreaterThan(.1);
  expect(heights(1 / 3)).toBeCloseTo(0, 9);
  expect(heights(.5)).toBeGreaterThan(.1);
});

test('a rabbit at rest sits still on the ground', () => {
  const model = animalModel('rabbit');
  model.position.y = 0;
  animateAnimal(model, 'rabbit', 4, false, 0);
  expect(model.position.y).toBe(0);
  const [body] = model.children;
  expect(body.rotation.x).toBe(0);
});

test('a boar keeps its walk, without hopping', () => {
  const model = animalModel('boar');
  model.position.y = 0;
  for (const phase of [0, .4, 1.1, 2.7]) animateAnimal(model, 'boar', phase, true, .5);
  expect(model.position.y).toBe(0);
});
