import * as T from 'three';
import type { Stores } from '../sim/types';
import { bundle, bundlesOf } from './food';
import { box, colors, group, post } from './primitives';

export function stall(parent: T.Object3D, x: number, y: number, z: number, color: number, stores: Stores = { wheat: 300 }): void {
  const shop = group(parent, x, y, z);
  box(shop, colors.wood, 0, .49, 0, 1.9, .85, 1.05);
  box(shop, colors.plaster, 0, .94, 0, 2.05, .12, 1.13);
  for (const px of [-.95, .95]) {
    for (const pz of [-.48, .6]) post(shop, colors.wood, px, 1.05, pz, .05, 2.1);
  }
  for (let stripe = 0; stripe < 7; stripe++) {
    const cloth = box(shop, stripe % 2 ? colors.linen : color, -.93 + stripe * .31, 2.04, .03, .31, .07, 1.5, .025);
    cloth.rotation.x = .12;
    box(shop, stripe % 2 ? colors.linen : color, -.93 + stripe * .31, 1.88, .78, .31, .2, .06);
  }
  const bundles = bundlesOf(stores, 3);
  for (let i = 0; i < 3; i++) {
    box(shop, colors.wood, -.6 + i * .6, 1.07, 0, .5, .16, .7);
    const food = bundles[i];
    if (food) {
      const crate = group(shop, -.6 + i * .6, 1.15, 0);
      crate.scale.setScalar(.95);
      bundle(crate, food, 0, 0, 0, i);
    }
  }
}
