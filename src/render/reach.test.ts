import { expect, test } from 'bun:test';
import { generateIsland, tileIndexOn } from '../sim/island';
import { reachOutline } from './reach';

const map = generateIsland(1);

function block(left: number, top: number, size: number): number[] {
  const tiles: number[] = [];
  for (let z = top; z < top + size; z++) {
    for (let x = left; x < left + size; x++) tiles.push(tileIndexOn(map, x, z));
  }
  return tiles;
}

function vertices(tiles: number[]): number {
  const mesh = reachOutline(map, tiles);
  return mesh ? mesh.geometry.getAttribute('position').count : 0;
}

test('nothing reachable draws nothing', () => {
  expect(reachOutline(map, [])).toBeNull();
});

test('a square draws one band per exposed edge, and a hole inside it changes nothing', () => {
  const square = block(40, 40, 5);
  expect(vertices(square)).toBe(4 * 5 * 6);

  const holed = square.filter((tile) => tile !== tileIndexOn(map, 42, 42));
  expect(vertices(holed)).toBe(vertices(square));
});

test('a gap open to the outside is traced, because the gatherer really is kept out', () => {
  const square = block(40, 40, 5);
  const notched = square.filter((tile) => tile !== tileIndexOn(map, 42, 44));
  expect(vertices(notched)).toBeGreaterThan(vertices(square));
});

test('the outline lies flat on the ground it describes', () => {
  const mesh = reachOutline(map, block(40, 40, 3))!;
  const normals = mesh.geometry.getAttribute('normal');
  for (let index = 0; index < normals.count; index++) {
    expect([normals.getX(index), normals.getY(index), normals.getZ(index)]).toEqual([0, 1, 0]);
  }
});
