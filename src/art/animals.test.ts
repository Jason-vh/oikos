import { expect, test } from 'bun:test';
import { animalModel, animateAnimal } from './animals';

function heights(stride: number): number {
  const model = animalModel('rabbit');
  model.position.y = 0;
  animateAnimal(model, 'rabbit', 0, true, stride);
  return model.position.y;
}

test('a rabbit crosses to the next spot in a single hop', () => {
  expect(heights(0)).toBeCloseTo(0, 9);
  expect(heights(1)).toBeCloseTo(0, 9);
  expect(heights(.5)).toBeGreaterThan(.15);
  expect(heights(.25)).toBeGreaterThan(0);
  expect(heights(.25)).toBeLessThan(heights(.5));
  expect(heights(.75)).toBeCloseTo(heights(.25), 9);
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
