import * as T from 'three';
import type { Food, Stores } from '../sim/types';
import { box, colors, group, lump, post } from './primitives';

export const BUNDLE_SIZE = 100;
export const FOOD_ORDER: Food[] = ['wheat', 'carrots', 'fish', 'meat', 'olives'];

export function bundlesOf(stores: Stores, slots: number): Food[] {
  const result: Food[] = [];
  for (const food of FOOD_ORDER) {
    const count = Math.ceil((stores[food] ?? 0) / BUNDLE_SIZE);
    for (let i = 0; i < count && result.length < slots; i++) result.push(food);
  }
  return result;
}

export function bundleKey(stores: Stores, slots: number): string {
  return bundlesOf(stores, slots).join(',');
}

export function bundle(parent: T.Object3D, food: Food, x: number, y: number, z: number, seed = 0): void {
  const pile = group(parent, x, y, z, seed * .9);
  switch (food) {
    case 'wheat':
      for (const [px, pz] of [[-.13, -.1], [.13, -.1], [0, .13]]) {
        post(pile, 0xd9c48f, px, .19, pz, .1, .38);
        lump(pile, colors.gold, px, .43, pz, .15, .13, .15);
      }
      break;
    case 'carrots':
      box(pile, colors.wood, 0, .09, 0, .5, .18, .42, .03);
      for (let i = 0; i < 5; i++) {
        const carrot = post(pile, 0xd97a3a, -.17 + i * .085, .24, 0, .045, .34);
        carrot.rotation.x = Math.PI / 2;
        lump(pile, colors.olive, -.17 + i * .085, .27, -.22, .07, .09, .07);
      }
      break;
    case 'fish':
      for (const px of [-.2, .2]) post(pile, colors.wood, px, .25, 0, .03, .5);
      box(pile, colors.wood, 0, .5, 0, .5, .03, .03);
      for (let i = 0; i < 4; i++) {
        const fish = lump(pile, 0x8fa9b3, -.15 + i * .1, .36, 0, .045, .13, .03);
        fish.rotation.z = .2;
      }
      break;
    case 'meat':
      for (const px of [-.2, .2]) post(pile, colors.wood, px, .25, 0, .03, .5);
      box(pile, colors.wood, 0, .5, 0, .5, .03, .03);
      for (let i = 0; i < 3; i++) lump(pile, 0x8e3f3a, -.14 + i * .14, .35, 0, .08, .15, .06);
      break;
    case 'olives':
      for (const [px, pz] of [[-.12, -.1], [.12, -.1], [0, .12]]) {
        lump(pile, colors.oliveDark, px, .17, pz, .13, .2, .13);
        post(pile, colors.oliveDark, px, .34, pz, .06, .08);
      }
      break;
  }
}
