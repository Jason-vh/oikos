import { expect, test } from 'bun:test';
import { parseView } from './view';

const view = { target: [2, 1.15, 3], offset: [35, 38, 48], size: 36, zoom: 1.5 };

test('restores the camera only for its saved island', () => {
  const raw = JSON.stringify({ seed: 1, view });
  expect(parseView(raw, 1)).toEqual(view);
  expect(parseView(raw, 2)).toBeNull();
});

test('invalid camera preferences never prevent opening the island', () => {
  for (const raw of [null, '{', 'null', '{}', JSON.stringify({ seed: 1, view: { ...view, zoom: 0 } }), JSON.stringify({ seed: 1, view: { ...view, offset: [0, 0, 0] } }), JSON.stringify({ seed: 1, view: { ...view, target: [0, 'NaN', 0] } })]) {
    expect(parseView(raw, 1)).toBeNull();
  }
});
