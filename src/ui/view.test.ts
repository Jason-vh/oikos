import { expect, test } from 'bun:test';
import { parseView } from './view';
import { islandFor } from '../sim/island';

const view = { target: [2, 1.15, 3], offset: [35, 38, 48], size: 36, zoom: 1.5 };

test('restores the camera only for its saved island', () => {
  const raw = JSON.stringify({ seed: 1, view });
  expect(parseView(raw, 1)).toEqual(view);
  expect(parseView(raw, 2)).toBeNull();
});

test('restores outer-island views and checks the chosen home', () => {
  const distantView = { ...view, target: [280, 1.15, -110], zoom: .3 };
  const raw = JSON.stringify({ seed: 1, home: 7, view: distantView });
  expect(parseView(raw, 1, 7)).toEqual(distantView);
  expect(parseView(raw, 1, 0)).toBeNull();
  expect(parseView(JSON.stringify({ seed: 1, view }), 1, islandFor(1).home)).toEqual(view);
  expect(parseView(JSON.stringify({ seed: 1, view }), 1, (islandFor(1).home + 1) % 8)).toBeNull();
});

test('invalid camera preferences never prevent opening the island', () => {
  for (const raw of [null, '{', 'null', '{}', JSON.stringify({ seed: 1, view: { ...view, zoom: 0 } }), JSON.stringify({ seed: 1, view: { ...view, offset: [0, 0, 0] } }), JSON.stringify({ seed: 1, view: { ...view, target: [0, 'NaN', 0] } })]) {
    expect(parseView(raw, 1)).toBeNull();
  }
});
