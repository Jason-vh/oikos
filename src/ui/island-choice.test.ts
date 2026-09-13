import { expect, test } from 'bun:test';
import { createIslandChoice } from './island-choice';
import { islandAt, islandFacts, islandFor, nextArchipelagoSeed } from '../sim/island';

function atlas() {
  const map = islandFor(2);
  const canvas = Object.assign(new EventTarget(), {
    getContext: () => null,
    remove: () => {},
    setAttribute: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: map.width, height: map.depth }),
  });
  const choice = Object.assign(new EventTarget(), {
    value: '', disabled: false,
    options: [{ value: '', disabled: true }, ...map.islands.map((_, index) => ({ value: String(index), disabled: false }))],
  });
  createIslandChoice(canvas as unknown as HTMLCanvasElement, choice as unknown as HTMLSelectElement, { textContent: '' } as HTMLElement)(2);
  function click(home: number): void {
    const index = map.terrain.findIndex((terrain, tile) => terrain !== 'water' && islandAt(map, tile % map.width, Math.floor(tile / map.width)) === map.islands[home]);
    const event = Object.assign(new Event('click'), { clientX: index % map.width + .5, clientY: Math.floor(index / map.width) + .5 });
    canvas.dispatchEvent(event);
  }
  return { choice, click };
}

test('atlas selection matches option values rather than the local placeholder index', () => {
  const h = atlas();
  h.click(0);
  expect(h.choice.value).toBe('0');
  h.choice.options[2].disabled = true;
  h.click(1);
  expect(h.choice.value).toBe('0');
  h.click(2);
  expect(h.choice.value).toBe('2');
});

test('disabled native selection also disables atlas selection', () => {
  const h = atlas();
  h.choice.disabled = true;
  h.click(0);
  expect(h.choice.value).toBe('');
  h.choice.disabled = false;
  h.click(0);
  expect(h.choice.value).toBe('0');
});

test('the preview uses exactly the next archipelago seed', () => {
  expect(nextArchipelagoSeed(1)).toBe(2);
  for (const seed of [2, 8, 37, 0xffffffff]) {
    expect(nextArchipelagoSeed(seed)).toBe((seed * 1103515245 + 12345) % 0x7fffffff);
    expect(Number.isInteger(nextArchipelagoSeed(seed))).toBe(true);
    expect(nextArchipelagoSeed(seed)).toBeGreaterThanOrEqual(0);
  }
});

test('island facts count the actual terrain without changing the shared map', () => {
  const map = islandFor(2);
  const before = [...map.terrain];
  const totals = { land: 0, fertile: 0, forest: 0 };
  for (let home = 0; home < map.islands.length; home++) {
    const facts = islandFacts(map, home);
    expect(facts.land).toBeGreaterThan(0);
    expect(facts.fertile).toBeGreaterThan(0);
    expect(facts.forest).toBeGreaterThan(0);
    totals.land += facts.land;
    totals.fertile += facts.fertile;
    totals.forest += facts.forest;
  }
  expect(totals.land).toBe(map.terrain.filter((terrain) => terrain !== 'water').length);
  expect(totals.fertile).toBe(map.terrain.filter((terrain) => terrain === 'fertile').length);
  expect(totals.forest).toBe(map.terrain.filter((terrain) => terrain === 'forest').length);
  expect(map.terrain).toEqual(before);
  expect(islandFacts(map, -1)).toEqual({ land: 0, fertile: 0, forest: 0 });
});
